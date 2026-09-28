import time
import httpx
from urllib.parse import quote, urlparse
from .config import settings
from .db import supabase

AUTH_URL = "https://www.strava.com/oauth/authorize"
TOKEN_URL = "https://www.strava.com/oauth/token"
API_BASE = "https://www.strava.com/api/v3"


def delete_tokens(user_id: str) -> None:
    supabase.table("strava_tokens").delete().eq("user_id", user_id).execute()


def authorization_url(user_id: str, redirect_to: str | None = None) -> str:
    # Strava's redirect_uri is fixed to this one backend regardless of which
    # frontend domain initiated the connection (golfcircle.me vs
    # slogs.co.za/handicap share this backend) -- so which domain to send
    # the browser back to afterwards has to travel through `state` instead,
    # since that's the only value Strava echoes back unchanged.
    state = f"{user_id}|{redirect_to}" if redirect_to else user_id

    return (
        f"{AUTH_URL}?client_id={settings.strava_client_id}"
        f"&response_type=code&redirect_uri={settings.strava_redirect_uri}"
        f"&approval_prompt=auto&scope=read,activity:read_all&state={quote(state, safe='')}"
    )


def parse_state(state: str) -> tuple[str, str | None]:
    if "|" not in state:
        return state, None

    user_id, redirect_to = state.split("|", 1)
    return user_id, redirect_to


def safe_redirect_target(redirect_to: str | None) -> str:
    """Only ever redirect back to a domain this backend actually serves --
    `state` is attacker-visible during the OAuth round trip, so this can't
    blindly trust whatever redirect_to it's handed back."""
    if redirect_to:
        origin = f"{urlparse(redirect_to).scheme}://{urlparse(redirect_to).netloc}"

        if origin in settings.frontend_urls:
            return redirect_to

    return f"{settings.app_url}/"

async def exchange_code(code: str) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(TOKEN_URL, data={
            "client_id": settings.strava_client_id,
            "client_secret": settings.strava_client_secret,
            "code": code,
            "grant_type": "authorization_code",
        })
        r.raise_for_status()
        return r.json()

async def refresh_token_if_needed(token_row: dict) -> dict:
    if token_row["expires_at"] > int(time.time()) + 3600:
        return token_row
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(TOKEN_URL, data={
            "client_id": settings.strava_client_id,
            "client_secret": settings.strava_client_secret,
            "grant_type": "refresh_token",
            "refresh_token": token_row["refresh_token"],
        })
        r.raise_for_status()
        fresh = r.json()
    updated = {
        "access_token": fresh["access_token"],
        "refresh_token": fresh["refresh_token"],
        "expires_at": fresh["expires_at"],
    }
    supabase.table("strava_tokens").update(updated).eq("athlete_id", token_row["athlete_id"]).execute()
    return {**token_row, **updated}

async def fetch_all_activities(access_token: str) -> list[dict]:
    all_rows = []
    page = 1
    async with httpx.AsyncClient(timeout=30) as client:
        while True:
            r = await client.get(
                f"{API_BASE}/athlete/activities",
                headers={"Authorization": f"Bearer {access_token}"},
                params={"page": page, "per_page": 100},
            )
            r.raise_for_status()
            batch = r.json()
            if not batch:
                break
            all_rows.extend(batch)
            if len(batch) < 100:
                break
            page += 1
    return all_rows
