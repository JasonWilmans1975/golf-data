from fastapi import Header, HTTPException

from .db import supabase


def _resolve_user(token: str) -> str:
    try:
        result = supabase.auth.get_user(token)
    except Exception:
        raise HTTPException(401, detail="Invalid or expired session")

    if not result or not result.user:
        raise HTTPException(401, detail="Invalid or expired session")

    return result.user.id


def get_current_user_id(authorization: str | None = Header(None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1]
    return _resolve_user(token)


def get_user_id_from_token(token: str) -> str:
    return _resolve_user(token)
