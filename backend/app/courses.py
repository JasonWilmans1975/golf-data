import math
import httpx
import os
import re

from dotenv import load_dotenv
from .db import supabase

load_dotenv()

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY")

GOOGLE_PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby"


def distance_km(lat1, lon1, lat2, lon2):
    r = 6371.0

    p1 = math.radians(lat1)
    p2 = math.radians(lat2)

    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)

    a = (
        math.sin(dp / 2) ** 2
        + math.cos(p1)
        * math.cos(p2)
        * math.sin(dl / 2) ** 2
    )

    return 2 * r * math.asin(math.sqrt(a))


async def find_nearest_golf_course(lat: float, lon: float):
    if not GOOGLE_MAPS_API_KEY:
        raise RuntimeError(
            "GOOGLE_MAPS_API_KEY is not set — required for course auto-detection"
        )

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": (
            "places.id,"
            "places.displayName,"
            "places.formattedAddress,"
            "places.location,"
            "places.types"
        ),
    }

    payload = {
        "includedTypes": ["golf_course"],
        "maxResultCount": 10,
        "rankPreference": "DISTANCE",
        "locationRestriction": {
            "circle": {
                "center": {
                    "latitude": lat,
                    "longitude": lon,
                },
                "radius": 10000.0,
            }
        },
    }

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            GOOGLE_PLACES_URL,
            headers=headers,
            json=payload,
        )

        response.raise_for_status()
        data = response.json()

    places = data.get("places", [])

    if not places:
        return None

    candidates = []

    for place in places:
        location = place.get("location", {})

        course_lat = location.get("latitude")
        course_lon = location.get("longitude")

        if course_lat is None or course_lon is None:
            continue

        name = (
            place.get("displayName", {}).get("text")
            or "Unknown Golf Course"
        )

        distance = distance_km(
            lat,
            lon,
            course_lat,
            course_lon,
        )

        candidates.append({
            "google_place_id": place.get("id"),
            "name": name,
            "formatted_address": place.get("formattedAddress"),
            "latitude": course_lat,
            "longitude": course_lon,
            "distance_km": distance,
        })

    if not candidates:
        return None

    candidates.sort(key=lambda x: x["distance_km"])

    return candidates[0]


GOOGLE_PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"


async def find_course_by_name(name: str):
    if not GOOGLE_MAPS_API_KEY:
        raise RuntimeError(
            "GOOGLE_MAPS_API_KEY is not set — required for course geocoding"
        )

    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": (
            "places.id,"
            "places.displayName,"
            "places.formattedAddress,"
            "places.location,"
            "places.addressComponents"
        ),
    }

    payload = {
        "textQuery": f"{name} golf course",
        "maxResultCount": 1,
    }

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            GOOGLE_PLACES_TEXT_SEARCH_URL,
            headers=headers,
            json=payload,
        )

        response.raise_for_status()
        data = response.json()

    places = data.get("places", [])

    if not places:
        return None

    place = places[0]
    location = place.get("location", {})

    if location.get("latitude") is None or location.get("longitude") is None:
        return None

    country_code = None
    country_name = None
    uk_nation = None

    for component in place.get("addressComponents", []):
        types = component.get("types", [])

        if "country" in types:
            country_code = (component.get("shortText") or "").lower() or None
            country_name = component.get("longText")

        if "administrative_area_level_1" in types:
            uk_nation = component.get("longText")

    # Google models the UK's constituent nations as admin-level-1 divisions.
    # For golf purposes these are usually treated as distinct "countries"
    # (e.g. The Open rotates among Scottish/English links courses), so use
    # the nation-specific flag rather than a single generic UK flag.
    uk_nation_codes = {
        "Scotland": "gb-sct",
        "England": "gb-eng",
        "Wales": "gb-wls",
        "Northern Ireland": "gb-nir",
    }

    if country_code == "gb" and uk_nation in uk_nation_codes:
        country_code = uk_nation_codes[uk_nation]
        country_name = uk_nation

    return {
        "google_place_id": place.get("id"),
        "formatted_address": place.get("formattedAddress"),
        "latitude": location["latitude"],
        "longitude": location["longitude"],
        "country_code": country_code,
        "country_name": country_name,
    }


async def geocode_courses_without_gps():
    response = (
        supabase
        .table("courses")
        .select("id,name")
        .is_("latitude", "null")
        .execute()
    )

    courses = response.data or []

    geocoded = 0
    failed = []

    for course in courses:
        try:
            result = await find_course_by_name(course["name"])

            if not result:
                failed.append({
                    "course_id": course["id"],
                    "name": course["name"],
                    "reason": "No match found",
                })
                continue

            supabase.table("courses").update(result).eq("id", course["id"]).execute()
            geocoded += 1

        except Exception as exc:
            failed.append({
                "course_id": course["id"],
                "name": course["name"],
                "reason": str(exc),
            })

    return {"checked": len(courses), "geocoded": geocoded, "failed": failed}


async def backfill_country_info():
    response = (
        supabase
        .table("courses")
        .select("id,name")
        .is_("country_code", "null")
        .execute()
    )

    courses = response.data or []

    updated = 0
    failed = []

    for course in courses:
        try:
            result = await find_course_by_name(course["name"])

            if not result or not result.get("country_code"):
                failed.append({
                    "course_id": course["id"],
                    "name": course["name"],
                    "reason": "No country found",
                })
                continue

            supabase.table("courses").update({
                "country_code": result["country_code"],
                "country_name": result["country_name"],
            }).eq("id", course["id"]).execute()

            updated += 1

        except Exception as exc:
            failed.append({
                "course_id": course["id"],
                "name": course["name"],
                "reason": str(exc),
            })

    return {"checked": len(courses), "updated": updated, "failed": failed}


def get_countries_played(user_id: str):
    courses = get_courses_for_user(user_id)

    countries = {}

    for course in courses:
        if course["rounds_played"] <= 0:
            continue

        code = course.get("country_code")

        if not code:
            continue

        entry = countries.setdefault(code, {
            "country_code": code,
            "country_name": course.get("country_name") or code.upper(),
            "course_count": 0,
        })

        entry["course_count"] += 1

    return sorted(countries.values(), key=lambda c: c["country_name"])


def find_existing_course(candidate):
    response = supabase.table("courses").select("*").execute()

    for course in response.data or []:
        if (
            candidate.get("google_place_id")
            and course.get("google_place_id") == candidate["google_place_id"]
        ):
            return course

        if not course.get("latitude") or not course.get("longitude"):
            continue

        distance = distance_km(
            candidate["latitude"],
            candidate["longitude"],
            course["latitude"],
            course["longitude"],
        )

        if distance <= 1:
            return course

    return None


def create_course(candidate):
    row = {
        "name": candidate["name"],
        "latitude": candidate["latitude"],
        "longitude": candidate["longitude"],
        "google_place_id": candidate.get("google_place_id"),
        "formatted_address": candidate.get("formatted_address"),
    }

    response = (
        supabase
        .table("courses")
        .insert(row)
        .execute()
    )

    return response.data[0]


async def detect_all_courses(user_id: str):
    activities_response = (
        supabase
        .table("golf_activities")
        .select("*")
        .eq("user_id", user_id)
        .is_("course_id", "null")
        .order("start_date")
        .execute()
    )

    activities = activities_response.data or []

    detected = 0
    failed = []

    lookup_cache = {}

    for activity in activities:
        coords = activity.get("start_latlng")

        if not coords or len(coords) != 2:
            failed.append({
                "activity_id": activity["id"],
                "reason": "No GPS coordinates",
            })
            continue

        lat = float(coords[0])
        lon = float(coords[1])

        cache_key = (
            round(lat, 3),
            round(lon, 3),
        )

        try:
            if cache_key in lookup_cache:
                candidate = lookup_cache[cache_key]
            else:
                candidate = await find_nearest_golf_course(lat, lon)
                lookup_cache[cache_key] = candidate

            if not candidate:
                failed.append({
                    "activity_id": activity["id"],
                    "reason": "No golf course found nearby",
                })
                continue

            course = find_existing_course(candidate)

            if not course:
                course = create_course(candidate)

            (
                supabase
                .table("golf_activities")
                .update({
                    "course_id": course["id"]
                })
                .eq("id", activity["id"])
                .execute()
            )

            detected += 1

        except Exception as exc:
            failed.append({
                "activity_id": activity["id"],
                "reason": str(exc),
            })

    return {
        "activities_checked": len(activities),
        "courses_detected": detected,
        "failed": failed,
    }


def get_courses_for_user(user_id: str):
    # courses is a shared/global table (the same physical course is reused
    # across users), so this must only return courses this user has actually
    # played — otherwise every user sees every other user's courses too.
    scores_response = (
        supabase
        .table("handicap_scores")
        .select("course_id,play_date")
        .eq("user_id", user_id)
        .not_.is_("course_id", "null")
        .execute()
    )

    stats_by_course = {}

    for score in scores_response.data or []:
        course_id = score["course_id"]
        play_date = score["play_date"]

        stats = stats_by_course.setdefault(course_id, {
            "rounds_played": 0,
            "first_played": play_date,
            "last_played": play_date,
        })

        stats["rounds_played"] += 1
        stats["first_played"] = min(stats["first_played"], play_date)
        stats["last_played"] = max(stats["last_played"], play_date)

    if not stats_by_course:
        return []

    courses_response = (
        supabase
        .table("courses")
        .select("*")
        .in_("id", list(stats_by_course.keys()))
        .order("name")
        .execute()
    )

    return [
        {**course, **stats_by_course[course["id"]]}
        for course in courses_response.data or []
    ]


def merge_courses(source_id: int, target_id: int):
    if source_id == target_id:
        raise ValueError("Cannot merge a course into itself")

    existing = (
        supabase
        .table("courses")
        .select("id")
        .in_("id", [source_id, target_id])
        .execute()
    )

    found_ids = {row["id"] for row in existing.data or []}

    if source_id not in found_ids or target_id not in found_ids:
        raise ValueError("Course not found")

    (
        supabase
        .table("handicap_scores")
        .update({"course_id": target_id})
        .eq("course_id", source_id)
        .execute()
    )

    (
        supabase
        .table("golf_activities")
        .update({"course_id": target_id})
        .eq("course_id", source_id)
        .execute()
    )

    supabase.table("courses").delete().eq("id", source_id).execute()

    return {"merged_from": source_id, "merged_into": target_id}


def _normalize_course_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def match_handicap_scores_to_courses(user_id: str):
    unmatched_response = (
        supabase
        .table("handicap_scores")
        .select("score_id,course_name,play_date")
        .eq("user_id", user_id)
        .is_("course_id", "null")
        .execute()
    )

    unmatched = unmatched_response.data or []

    if not unmatched:
        return {"matched": 0, "created_courses": 0}

    courses_response = supabase.table("courses").select("id,name").execute()

    by_normalized = {
        _normalize_course_name(course["name"]): course["id"]
        for course in courses_response.data or []
        if course.get("name")
    }

    groups: dict[str, list[tuple[int, str]]] = {}
    display_names: dict[str, str] = {}

    for score in unmatched:
        raw_name = (score.get("course_name") or "").strip()

        if not raw_name:
            continue

        key = _normalize_course_name(raw_name)
        groups.setdefault(key, []).append((score["score_id"], score["play_date"]))
        display_names.setdefault(key, raw_name)

    # One bulk insert/upsert per sync instead of one round trip per distinct
    # course name — a heavy first-time sync (hundreds of historical rounds
    # across many courses) was slow enough to hit the request/gateway
    # timeout before finishing, so the sync never got marked complete and
    # kept silently re-running on every page load.
    new_keys = [key for key in groups if key not in by_normalized]

    if new_keys:
        insert_response = (
            supabase
            .table("courses")
            .insert([{"name": display_names[key].title()} for key in new_keys])
            .execute()
        )

        for course in insert_response.data:
            by_normalized[_normalize_course_name(course["name"])] = course["id"]

    score_updates = [
        {"score_id": score_id, "course_id": by_normalized[key], "play_date": play_date}
        for key, scores in groups.items()
        for score_id, play_date in scores
    ]

    if score_updates:
        supabase.table("handicap_scores").upsert(score_updates, on_conflict="score_id").execute()

    return {"matched": len(score_updates), "created_courses": len(new_keys)}