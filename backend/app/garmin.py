import asyncio
from datetime import datetime, timedelta, timezone

from garminconnect import Garmin

from .db import supabase
from .crypto import encrypt, decrypt

# First sync per user pulls this far back; later syncs only need "since
# yesterday" but we re-scan the same window each time since it's cheap and
# self-healing if a past sync was interrupted.
GARMIN_LOOKBACK_DAYS = 365 * 5


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


def _fetch_golf_activities_sync(user_id: str, start_date: str) -> list[dict]:
    api = _login_sync(user_id)
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


async def sync_garmin_data(user_id: str, force: bool = False):
    if not force and _already_synced_today(user_id):
        return {"skipped": True, "reason": "Already synced today"}

    start_date = (
        datetime.now(timezone.utc) - timedelta(days=GARMIN_LOOKBACK_DAYS)
    ).date().isoformat()

    activities = await asyncio.to_thread(_fetch_golf_activities_sync, user_id, start_date)

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
            "moving_time_s": activity.get("movingDuration") or activity.get("duration") or 0,
            "elapsed_time_s": activity.get("duration") or 0,
            "elevation_gain_m": activity.get("elevationGain") or 0,
            "start_latlng": [lat, lon] if lat is not None and lon is not None else None,
            "end_latlng": None,
            "map_polyline": None,
            "raw": activity,
        })

    if rows:
        supabase.table("golf_activities").upsert(rows, on_conflict="garmin_activity_id").execute()

    _mark_synced_now(user_id)

    return {"imported": len(rows), "total_activities_seen": len(activities)}
