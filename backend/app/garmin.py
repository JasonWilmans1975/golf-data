import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone

from garminconnect import Garmin

from .db import supabase
from .crypto import encrypt, decrypt

# First sync per user pulls this far back; later syncs only need "since
# yesterday" but we re-scan the same window each time since it's cheap and
# self-healing if a past sync was interrupted.
GARMIN_LOOKBACK_DAYS = 365 * 5

# Wellness stats (calories/heart rate/sleep) only need a one-time deep
# backfill; once a user has that much history, every later sync just
# refreshes a short trailing window (self-healing if a sync was missed).
GARMIN_WELLNESS_BACKFILL_DAYS = 100
GARMIN_WELLNESS_ROLLING_DAYS = 5

# Garmin has no batch endpoint for whole-day average heart rate (only
# per-day intraday samples), so a deep backfill means one call per day.
# Fetching them concurrently keeps a 100-day backfill from taking minutes.
GARMIN_HEART_RATE_WORKERS = 6


def save_credentials(user_id: str, email: str, password: str):
    supabase.table("garmin_credentials").upsert({
        "user_id": user_id,
        "email": email,
        "encrypted_password": encrypt(password),
        "cached_token": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).execute()


def has_credentials(user_id: str) -> bool:
    response = (
        supabase
        .table("garmin_credentials")
        .select("user_id")
        .eq("user_id", user_id)
        .execute()
    )

    return bool(response.data)


def _get_credentials_row(user_id: str):
    response = (
        supabase
        .table("garmin_credentials")
        .select("email,encrypted_password,cached_token")
        .eq("user_id", user_id)
        .execute()
    )

    if not response.data:
        raise RuntimeError(
            "No Garmin Connect credentials saved yet — add them in Settings"
        )

    return response.data[0]


def _login_sync(user_id: str) -> Garmin:
    row = _get_credentials_row(user_id)
    email = row["email"]
    password = decrypt(row["encrypted_password"])
    cached_token = row.get("cached_token")

    api = Garmin(email=email, password=password)

    try:
        api.login(tokenstore=decrypt(cached_token) if cached_token else None)
    except Exception as exc:
        raise RuntimeError(
            "Garmin Connect rejected the email/password, or the account has "
            "two-factor authentication enabled (not supported yet)"
        ) from exc

    # Re-cache the session token so future syncs skip the password login
    # (cheaper, and less likely to trip Garmin's bot detection).
    supabase.table("garmin_credentials").update({
        "cached_token": encrypt(api.client.dumps()),
    }).eq("user_id", user_id).execute()

    return api


def _fetch_golf_activities(api: Garmin, start_date: str) -> list[dict]:
    end_date = datetime.now(timezone.utc).date().isoformat()
    activities = api.get_activities_by_date(start_date, end_date)

    return [
        activity for activity in activities
        if (activity.get("activityType") or {}).get("typeKey") == "golf"
    ]


def _parse_garmin_datetime(value: str | None) -> str | None:
    if not value:
        return None

    return value.replace(" ", "T")


def _to_int(value) -> int | None:
    if value in (None, ""):
        return None

    try:
        return round(float(value))
    except (TypeError, ValueError):
        return None


def _fetch_average_heart_rate(api: Garmin, day: str) -> int | None:
    try:
        heart_rates = api.get_heart_rates(day) or {}
    except Exception:
        return None

    values = heart_rates.get("heartRateValues") or []
    valid_readings = [v[1] for v in values if v and v[1] is not None]

    return round(sum(valid_readings) / len(valid_readings)) if valid_readings else None


def _needs_wellness_backfill(user_id: str) -> bool:
    response = (
        supabase
        .table("garmin_daily_stats")
        .select("stat_date")
        .eq("user_id", user_id)
        .order("stat_date")
        .limit(1)
        .execute()
    )

    if not response.data:
        return True

    earliest = datetime.fromisoformat(response.data[0]["stat_date"]).date()
    cutoff = datetime.now(timezone.utc).date() - timedelta(
        days=GARMIN_WELLNESS_BACKFILL_DAYS - 5
    )

    return earliest > cutoff


def _fetch_wellness(api: Garmin, days: int) -> list[dict]:
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days - 1)
    start_str, end_str = start.isoformat(), end.isoformat()

    calories_by_date = {
        entry.get("calendarDate"): entry
        for entry in (api.get_calories_daily(start_str, end_str) or [])
    }
    sleep_by_date = {
        entry.get("calendarDate"): entry.get("values") or {}
        for entry in (api.get_sleep_daily(start_str, end_str) or [])
    }
    resting_hr_by_date = {
        entry.get("calendarDate"): entry.get("value")
        for entry in (api.get_rhr_daily(start_str, end_str) or [])
    }

    dates = [(start + timedelta(days=i)).isoformat() for i in range(days)]

    average_hr_by_date = {}
    with ThreadPoolExecutor(max_workers=GARMIN_HEART_RATE_WORKERS) as pool:
        future_to_date = {
            pool.submit(_fetch_average_heart_rate, api, day): day for day in dates
        }
        for future in as_completed(future_to_date):
            average_hr_by_date[future_to_date[future]] = future.result()

    rows = []
    for day in dates:
        calories = calories_by_date.get(day) or {}
        sleep = sleep_by_date.get(day) or {}

        rows.append({
            "stat_date": day,
            "total_calories": _to_int(calories.get("total")),
            "active_calories": _to_int(calories.get("active")),
            "resting_calories": _to_int(calories.get("resting")),
            "average_heart_rate": average_hr_by_date.get(day),
            "resting_heart_rate": _to_int(resting_hr_by_date.get(day)),
            "sleep_score": sleep.get("sleepScore"),
            "sleep_score_qualifier": sleep.get("sleepScoreQuality"),
            "sleep_seconds": sleep.get("totalSleepTimeInSeconds"),
        })

    return rows


def _already_synced_today(user_id: str) -> bool:
    state = (
        supabase
        .table("garmin_sync_state")
        .select("last_synced_at")
        .eq("user_id", user_id)
        .execute()
    )

    if not state.data or not state.data[0]["last_synced_at"]:
        return False

    last_synced_at = datetime.fromisoformat(state.data[0]["last_synced_at"])

    return last_synced_at.astimezone(timezone.utc).date() == datetime.now(timezone.utc).date()


def _mark_synced_now(user_id: str):
    supabase.table("garmin_sync_state").upsert({
        "user_id": user_id,
        "last_synced_at": datetime.now(timezone.utc).isoformat(),
    }).execute()


def _run_full_sync(user_id: str, start_date: str) -> dict:
    api = _login_sync(user_id)
    activities = _fetch_golf_activities(api, start_date)

    wellness_days = (
        GARMIN_WELLNESS_BACKFILL_DAYS
        if _needs_wellness_backfill(user_id)
        else GARMIN_WELLNESS_ROLLING_DAYS
    )
    wellness_rows = _fetch_wellness(api, wellness_days)

    return {"activities": activities, "wellness_rows": wellness_rows}


async def sync_garmin_data(user_id: str, force: bool = False):
    if not force and _already_synced_today(user_id):
        return {"skipped": True, "reason": "Already synced today"}

    start_date = (
        datetime.now(timezone.utc) - timedelta(days=GARMIN_LOOKBACK_DAYS)
    ).date().isoformat()

    result = await asyncio.to_thread(_run_full_sync, user_id, start_date)
    activities = result["activities"]
    wellness_rows = result["wellness_rows"]

    rows = []
    for activity in activities:
        activity_id = activity.get("activityId")
        if not activity_id:
            continue

        lat = activity.get("startLatitude")
        lon = activity.get("startLongitude")

        rows.append({
            "garmin_activity_id": activity_id,
            "source": "garmin",
            "user_id": user_id,
            "name": activity.get("activityName"),
            "sport_type": "Golf",
            "start_date": _parse_garmin_datetime(activity.get("startTimeGMT")),
            "start_date_local": _parse_garmin_datetime(activity.get("startTimeLocal")),
            "distance_m": activity.get("distance") or 0,
            "moving_time_s": _to_int(activity.get("movingDuration") or activity.get("duration")) or 0,
            "elapsed_time_s": _to_int(activity.get("duration")) or 0,
            "elevation_gain_m": activity.get("elevationGain") or 0,
            "start_latlng": [lat, lon] if lat is not None and lon is not None else None,
            "end_latlng": None,
            "map_polyline": None,
            "raw": activity,
        })

    if rows:
        supabase.table("golf_activities").upsert(rows, on_conflict="garmin_activity_id").execute()

    if wellness_rows:
        supabase.table("garmin_daily_stats").upsert(
            [{**row, "user_id": user_id} for row in wellness_rows],
            on_conflict="user_id,stat_date",
        ).execute()

    _mark_synced_now(user_id)

    return {
        "imported": len(rows),
        "total_activities_seen": len(activities),
        "wellness_days_synced": len(wellness_rows),
    }
