import time

from fastapi import Header, HTTPException

from .db import supabase


def _resolve_user(token: str) -> str:
    user_id = None

    for attempt in range(3):
        try:
            result = supabase.auth.get_user(token)
            user_id = result and result.user and result.user.id
            break
        except Exception:
            if attempt < 2:
                time.sleep(0.3)

    if not user_id:
        raise HTTPException(401, detail="Invalid or expired session")

    return user_id


def get_current_user_id(authorization: str | None = Header(None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1]
    return _resolve_user(token)


def get_user_id_from_token(token: str) -> str:
    return _resolve_user(token)
