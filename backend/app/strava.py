import time
import httpx
from .config import settings
from .db import supabase

AUTH_URL = "https://www.strava.com/oauth/authorize"
TOKEN_URL = "https://www.strava.com/oauth/token"
API_BASE = "https://www.strava.com/api/v3"


def authorization_url(user_id: str) -> str:
    return (
        f"{AUTH_URL}?client_id={settings.strava_client_id}"
        f"&response_type=code&redirect_uri={settings.strava_redirect_uri}"
        f"&approval_prompt=auto&scope=read,activity:read_all&state={user_id}"
    )

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
