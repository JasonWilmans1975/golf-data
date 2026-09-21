import uuid

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from .config import settings
from .db import supabase
from .auth import get_current_user_id, get_user_id_from_token
from .strava import authorization_url, exchange_code, refresh_token_if_needed, fetch_all_activities
from .courses import (
    detect_all_courses,
    get_courses_for_user,
    merge_courses,
    geocode_courses_without_gps,
    backfill_country_info,
    get_countries_played,
)
from .handicap import sync_handicap_data, save_credentials, has_credentials

COURSE_PHOTOS_BUCKET = "course-photos"

app = FastAPI(title="Golf Journey API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    origin = request.headers.get("origin")

    headers = {}
    if origin == settings.frontend_url:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"

    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
        headers=headers,
    )

@app.get("/health")
def health():
    return {"ok": True}

@app.get("/auth/strava")
def auth_strava(token: str):
    user_id = get_user_id_from_token(token)
    return RedirectResponse(authorization_url(user_id))

@app.get("/auth/strava/callback")
async def auth_callback(code: str | None = None, error: str | None = None, state: str | None = None):
    if error or not code or not state:
        raise HTTPException(400, detail=error or "Missing authorization code")
    user_id = state
    data = await exchange_code(code)
    athlete = data["athlete"]
    row = {
        "athlete_id": athlete["id"],
        "user_id": user_id,
        "access_token": data["access_token"],
        "refresh_token": data["refresh_token"],
        "expires_at": data["expires_at"],
        "scope": data.get("scope", ""),
        "athlete": athlete,
    }
    supabase.table("strava_tokens").upsert(row, on_conflict="athlete_id").execute()
    return RedirectResponse(f"{settings.app_url}/?connected=1")

@app.post("/sync")
async def sync(user_id: str = Depends(get_current_user_id)):
    token_resp = (
        supabase.table("strava_tokens")
        .select("*")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not token_resp.data:
        raise HTTPException(401, detail="Connect Strava first")
    token = await refresh_token_if_needed(token_resp.data[0])
    activities = await fetch_all_activities(token["access_token"])
    golf = [a for a in activities if a.get("sport_type") == "Golf" or a.get("type") == "Golf"]
    rows = []
    for a in golf:
        rows.append({
            "strava_activity_id": a["id"],
            "athlete_id": token["athlete_id"],
            "user_id": user_id,
            "name": a.get("name"),
            "sport_type": a.get("sport_type") or a.get("type"),
            "start_date": a.get("start_date"),
            "start_date_local": a.get("start_date_local"),
            "timezone": a.get("timezone"),
            "distance_m": a.get("distance", 0),
            "moving_time_s": a.get("moving_time", 0),
            "elapsed_time_s": a.get("elapsed_time", 0),
            "elevation_gain_m": a.get("total_elevation_gain", 0),
            "start_latlng": a.get("start_latlng"),
            "end_latlng": a.get("end_latlng"),
            "map_polyline": (a.get("map") or {}).get("summary_polyline"),
            "raw": a,
        })
    if rows:
        supabase.table("golf_activities").upsert(rows, on_conflict="strava_activity_id").execute()
    return {"imported": len(rows), "total_activities_seen": len(activities)}

@app.get("/activities")
def activities(user_id: str = Depends(get_current_user_id)):
    r = (
        supabase.table("golf_activities")
        .select("*")
        .eq("user_id", user_id)
        .order("start_date", desc=True)
        .execute()
    )
    return r.data

@app.get("/stats")
def stats(user_id: str = Depends(get_current_user_id)):
    r = supabase.table("golf_activities").select("*").eq("user_id", user_id).execute()
    rows = r.data or []

    scores_r = (
        supabase.table("handicap_scores")
        .select("id")
        .eq("user_id", user_id)
        .execute()
    )
    total_rounds = len(scores_r.data or []) or len(rows)

    return {
        "rounds": total_rounds,
        "distance_km": round(sum((x.get("distance_m") or 0) for x in rows) / 1000, 1),
        "elevation_m": round(sum((x.get("elevation_gain_m") or 0) for x in rows), 0),
        "moving_hours": round(sum((x.get("moving_time_s") or 0) for x in rows) / 3600, 1),
    }


@app.post("/courses/detect")
async def courses_detect(user_id: str = Depends(get_current_user_id)):
    return await detect_all_courses(user_id)


@app.post("/courses/geocode")
async def courses_geocode(user_id: str = Depends(get_current_user_id)):
    return await geocode_courses_without_gps()


@app.post("/courses/backfill-countries")
async def courses_backfill_countries(user_id: str = Depends(get_current_user_id)):
    return await backfill_country_info()


@app.get("/courses")
def courses(user_id: str = Depends(get_current_user_id)):
    return get_courses_for_user(user_id)


@app.get("/courses/countries")
def courses_countries(user_id: str = Depends(get_current_user_id)):
    return get_countries_played(user_id)


@app.post("/courses/{course_id}/merge")
def merge_course(course_id: int, into_course_id: int, user_id: str = Depends(get_current_user_id)):
    try:
        return merge_courses(course_id, into_course_id)
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))


@app.post("/courses/{course_id}/photo")
async def upload_course_photo(
    course_id: int,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    existing = (
        supabase
        .table("courses")
        .select("id")
        .eq("id", course_id)
        .execute()
    )

    if not existing.data:
        raise HTTPException(404, detail="Course not found")

    contents = await file.read()
    extension = (file.filename or "").rsplit(".", 1)[-1].lower() or "jpg"
    path = f"{course_id}/{uuid.uuid4().hex}.{extension}"

    supabase.storage.from_(COURSE_PHOTOS_BUCKET).upload(
        path,
        contents,
        {"content-type": file.content_type or "image/jpeg"},
    )

    photo_url = supabase.storage.from_(COURSE_PHOTOS_BUCKET).get_public_url(path)

    supabase.table("courses").update({"photo_url": photo_url}).eq("id", course_id).execute()

    return {"photo_url": photo_url}


class HandicapCredentials(BaseModel):
    member_no: str
    password: str


@app.post("/handicap/credentials")
def handicap_credentials(
    body: HandicapCredentials,
    user_id: str = Depends(get_current_user_id),
):
    save_credentials(user_id, body.member_no, body.password)
    return {"saved": True}


@app.get("/handicap/credentials/status")
def handicap_credentials_status(user_id: str = Depends(get_current_user_id)):
    return {"connected": has_credentials(user_id)}


@app.post("/handicap/sync")
async def handicap_sync(force: bool = False, user_id: str = Depends(get_current_user_id)):
    try:
        return await sync_handicap_data(user_id, force=force)
    except RuntimeError as exc:
        raise HTTPException(502, detail=str(exc))


@app.get("/handicap")
def handicap_history(user_id: str = Depends(get_current_user_id)):
    response = (
        supabase
        .table("handicap_scores")
        .select("play_date,handicap_index")
        .eq("user_id", user_id)
        .not_.is_("handicap_index", "null")
        .order("play_date")
        .execute()
    )

    deduped = {}
    for row in response.data or []:
        deduped[row["play_date"]] = row["handicap_index"]

    return [
        {"recorded_at": play_date, "handicap_index": handicap_index}
        for play_date, handicap_index in sorted(deduped.items())
    ]


@app.get("/handicap/current")
def handicap_current(user_id: str = Depends(get_current_user_id)):
    response = (
        supabase
        .table("handicap_sync_state")
        .select("current_handicap_index,last_synced_at")
        .eq("user_id", user_id)
        .execute()
    )

    if not response.data:
        return {"current_handicap_index": None, "last_synced_at": None}

    return response.data[0]


@app.get("/handicap/scores")
def handicap_scores(limit: int = 50, user_id: str = Depends(get_current_user_id)):
    response = (
        supabase
        .table("handicap_scores")
        .select("*")
        .eq("user_id", user_id)
        .order("play_date", desc=True)
        .limit(limit)
        .execute()
    )

    return response.data
