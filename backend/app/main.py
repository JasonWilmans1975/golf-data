import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel
from .config import settings
from .db import supabase, fetch_all
from .auth import get_current_user_id, get_user_id_from_token
from .strava import authorization_url, exchange_code, refresh_token_if_needed, fetch_all_activities
from .courses import (
    detect_all_courses,
    get_courses_for_user,
    merge_courses,
    geocode_courses_without_gps,
    backfill_country_info,
    backfill_course_details,
    get_countries_played,
)
from .handicap import sync_handicap_data, save_credentials, has_credentials
from .garmin import (
    sync_garmin_data,
    save_credentials as save_garmin_credentials,
    has_credentials as has_garmin_credentials,
)
from .teesheet import (
    save_credentials as save_teesheet_credentials,
    has_credentials as has_teesheet_credentials,
    sync_teesheet_data,
)
from .friends import (
    get_profile,
    update_display_name,
    send_friend_request,
    list_incoming_requests,
    list_sent_requests,
    cancel_sent_request,
    respond_to_request,
    list_friends,
    remove_friend,
    get_friends_feed,
    get_activity_feed,
    create_post,
    list_comments,
    list_comments_batch,
    add_comment,
    delete_comment,
    toggle_reaction,
    acknowledge_notifications,
    list_notifications,
)

COURSE_PHOTOS_BUCKET = "course-photos"
POST_PHOTOS_BUCKET = "post-photos"

app = FastAPI(title="GolfCircle API")
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

@app.get("/strava/status")
def strava_status(user_id: str = Depends(get_current_user_id)):
    token_resp = (
        supabase.table("strava_tokens")
        .select("athlete_id")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return {"connected": bool(token_resp.data)}

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
    rows = fetch_all(
        lambda: supabase.table("golf_activities")
        .select("*")
        .eq("user_id", user_id)
        .order("start_date", desc=True)
    )
    return rows

@app.get("/stats")
def stats(user_id: str = Depends(get_current_user_id)):
    rows = fetch_all(
        lambda: supabase.table("golf_activities").select("*").eq("user_id", user_id).order("id")
    )

    scores = fetch_all(
        lambda: supabase.table("handicap_scores").select("id").eq("user_id", user_id).order("id")
    )
    total_rounds = len(scores) or len(rows)

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


@app.post("/courses/backfill-details")
async def courses_backfill_details(user_id: str = Depends(get_current_user_id)):
    return await backfill_course_details()


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


class GarminCredentials(BaseModel):
    email: str
    password: str


@app.post("/garmin/credentials")
def garmin_credentials(
    body: GarminCredentials,
    user_id: str = Depends(get_current_user_id),
):
    save_garmin_credentials(user_id, body.email, body.password)
    return {"saved": True}


@app.get("/garmin/credentials/status")
def garmin_credentials_status(user_id: str = Depends(get_current_user_id)):
    return {"connected": has_garmin_credentials(user_id)}


@app.post("/garmin/sync")
async def garmin_sync(force: bool = False, user_id: str = Depends(get_current_user_id)):
    try:
        return await sync_garmin_data(user_id, force=force)
    except RuntimeError as exc:
        raise HTTPException(502, detail=str(exc))


@app.get("/garmin/wellness")
def garmin_wellness(days: int = 120, user_id: str = Depends(get_current_user_id)):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).date().isoformat()

    response = (
        supabase
        .table("garmin_daily_stats")
        .select("*")
        .eq("user_id", user_id)
        .gte("stat_date", since)
        .order("stat_date")
        .execute()
    )

    return response.data


class TeesheetCredentials(BaseModel):
    club_id: int
    club_name: str
    member_id: str
    password: str


@app.post("/teesheet/credentials")
def teesheet_credentials(
    body: TeesheetCredentials,
    user_id: str = Depends(get_current_user_id),
):
    save_teesheet_credentials(
        user_id, body.club_id, body.club_name, body.member_id, body.password
    )
    return {"saved": True}


@app.get("/teesheet/credentials/status")
def teesheet_credentials_status(user_id: str = Depends(get_current_user_id)):
    return {"connected": has_teesheet_credentials(user_id)}


@app.post("/teesheet/sync")
async def teesheet_sync(force: bool = False, user_id: str = Depends(get_current_user_id)):
    try:
        return await sync_teesheet_data(user_id, force=force)
    except RuntimeError as exc:
        raise HTTPException(502, detail=str(exc))


@app.get("/teesheet/bookings")
def teesheet_bookings(user_id: str = Depends(get_current_user_id)):
    response = (
        supabase
        .table("teesheet_bookings")
        .select("*")
        .eq("user_id", user_id)
        .gte("play_date", datetime.now(timezone.utc).date().isoformat())
        .order("play_date")
        .execute()
    )

    return response.data


@app.get("/teesheet/transactions")
def teesheet_transactions(limit: int = 50, user_id: str = Depends(get_current_user_id)):
    response = (
        supabase
        .table("teesheet_transactions")
        .select("*")
        .eq("user_id", user_id)
        .order("transaction_at", desc=True)
        .limit(limit)
        .execute()
    )

    return response.data


@app.get("/teesheet/balance")
def teesheet_balance(user_id: str = Depends(get_current_user_id)):
    response = (
        supabase
        .table("teesheet_sync_state")
        .select("current_balance,last_synced_at")
        .eq("user_id", user_id)
        .execute()
    )

    if not response.data:
        return {"current_balance": None, "last_synced_at": None}

    return response.data[0]


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
    rows = fetch_all(
        lambda: supabase
        .table("handicap_scores")
        .select("play_date,handicap_index")
        .eq("user_id", user_id)
        .not_.is_("handicap_index", "null")
        .order("play_date")
    )

    deduped = {}
    for row in rows:
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


class DisplayNameUpdate(BaseModel):
    display_name: str


@app.get("/profile")
def profile(user_id: str = Depends(get_current_user_id)):
    return get_profile(user_id)


@app.put("/profile")
def profile_update(body: DisplayNameUpdate, user_id: str = Depends(get_current_user_id)):
    try:
        return update_display_name(user_id, body.display_name)
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))


class FriendRequestBody(BaseModel):
    email: str


@app.post("/friends/requests")
def friends_send_request(body: FriendRequestBody, user_id: str = Depends(get_current_user_id)):
    try:
        return send_friend_request(user_id, body.email)
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))


@app.get("/friends/requests")
def friends_incoming_requests(user_id: str = Depends(get_current_user_id)):
    return list_incoming_requests(user_id)


@app.get("/friends/requests/sent")
def friends_sent_requests(user_id: str = Depends(get_current_user_id)):
    return list_sent_requests(user_id)


@app.delete("/friends/requests/{request_id}")
def friends_cancel_request(request_id: int, user_id: str = Depends(get_current_user_id)):
    try:
        cancel_sent_request(user_id, request_id)
    except ValueError as exc:
        raise HTTPException(404, detail=str(exc))

    return {"cancelled": True}


@app.post("/friends/requests/{request_id}/accept")
def friends_accept_request(request_id: int, user_id: str = Depends(get_current_user_id)):
    try:
        return respond_to_request(user_id, request_id, accept=True)
    except ValueError as exc:
        raise HTTPException(404, detail=str(exc))


@app.post("/friends/requests/{request_id}/decline")
def friends_decline_request(request_id: int, user_id: str = Depends(get_current_user_id)):
    try:
        return respond_to_request(user_id, request_id, accept=False)
    except ValueError as exc:
        raise HTTPException(404, detail=str(exc))


@app.get("/friends/feed")
def friends_feed(limit: int = 30, user_id: str = Depends(get_current_user_id)):
    return get_friends_feed(user_id, limit=limit)


@app.get("/friends")
def friends_list(user_id: str = Depends(get_current_user_id)):
    return list_friends(user_id)


@app.delete("/friends/{friend_user_id}")
def friends_remove(friend_user_id: str, user_id: str = Depends(get_current_user_id)):
    remove_friend(user_id, friend_user_id)
    return {"removed": True}


@app.get("/feed")
def activity_feed(limit: int = 20, offset: int = 0, user_id: str = Depends(get_current_user_id)):
    return get_activity_feed(user_id, limit=limit, offset=offset)


class PostBody(BaseModel):
    body: str = ""
    shared_item_type: str | None = None
    shared_item_id: int | None = None
    photo_url: str | None = None


@app.post("/feed/posts")
def feed_create_post(body: PostBody, user_id: str = Depends(get_current_user_id)):
    try:
        return create_post(
            user_id, body.body, body.shared_item_type, body.shared_item_id, body.photo_url
        )
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))


@app.post("/feed/posts/photo")
async def upload_post_photo(
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
):
    contents = await file.read()
    extension = (file.filename or "").rsplit(".", 1)[-1].lower() or "jpg"
    path = f"{user_id}/{uuid.uuid4().hex}.{extension}"

    supabase.storage.from_(POST_PHOTOS_BUCKET).upload(
        path,
        contents,
        {"content-type": file.content_type or "image/jpeg"},
    )

    photo_url = supabase.storage.from_(POST_PHOTOS_BUCKET).get_public_url(path)

    return {"photo_url": photo_url}


@app.get("/feed/{item_type}/{item_id}/comments")
def feed_comments_list(
    item_type: str, item_id: int, user_id: str = Depends(get_current_user_id)
):
    try:
        return list_comments(user_id, item_type, item_id)
    except ValueError as exc:
        raise HTTPException(404, detail=str(exc))


class CommentBatchItem(BaseModel):
    item_type: str
    item_id: int


class CommentBatchBody(BaseModel):
    items: list[CommentBatchItem]


@app.post("/feed/comments/batch")
def feed_comments_batch(body: CommentBatchBody, user_id: str = Depends(get_current_user_id)):
    return list_comments_batch(user_id, [(item.item_type, item.item_id) for item in body.items])


class CommentBody(BaseModel):
    body: str


@app.post("/feed/{item_type}/{item_id}/comments")
def feed_comments_create(
    item_type: str, item_id: int, body: CommentBody, user_id: str = Depends(get_current_user_id)
):
    try:
        return add_comment(user_id, item_type, item_id, body.body)
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))


@app.delete("/feed/comments/{comment_id}")
def feed_comment_delete(comment_id: int, user_id: str = Depends(get_current_user_id)):
    try:
        delete_comment(user_id, comment_id)
    except ValueError as exc:
        raise HTTPException(404, detail=str(exc))

    return {"removed": True}


class ReactionBody(BaseModel):
    reaction: str = "like"


@app.post("/feed/{item_type}/{item_id}/react")
def feed_react(
    item_type: str, item_id: int, body: ReactionBody, user_id: str = Depends(get_current_user_id)
):
    try:
        return toggle_reaction(user_id, item_type, item_id, body.reaction)
    except ValueError as exc:
        raise HTTPException(400, detail=str(exc))


@app.get("/notifications")
def notifications_list(limit: int = 20, user_id: str = Depends(get_current_user_id)):
    return list_notifications(user_id, limit=limit)


@app.post("/notifications/ack")
def notifications_ack(user_id: str = Depends(get_current_user_id)):
    acknowledge_notifications(user_id)
    return {"acknowledged": True}
