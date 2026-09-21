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
    courses_response = supabase.table("courses").select("*").order("name").execute()

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

    result = []

    for course in courses_response.data or []:
        stats = stats_by_course.get(course["id"], {
            "rounds_played": 0,
            "first_played": None,
            "last_played": None,
        })

        result.append({**course, **stats})

    return result


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
        .select("id,course_name")
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

    groups: dict[str, list[int]] = {}
    display_names: dict[str, str] = {}

    for score in unmatched:
        raw_name = (score.get("course_name") or "").strip()

        if not raw_name:
            continue

        key = _normalize_course_name(raw_name)
        groups.setdefault(key, []).append(score["id"])
        display_names.setdefault(key, raw_name)

    matched = 0
    created = 0

    for key, score_ids in groups.items():
        course_id = by_normalized.get(key)

        if not course_id:
            insert_response = (
                supabase
                .table("courses")
                .insert({"name": display_names[key].title()})
                .execute()
            )
            course_id = insert_response.data[0]["id"]
            by_normalized[key] = course_id
            created += 1

        (
            supabase
            .table("handicap_scores")
            .update({"course_id": course_id})
            .in_("id", score_ids)
            .execute()
        )

        matched += len(score_ids)

    return {"matched": matched, "created_courses": created}