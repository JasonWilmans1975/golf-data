from fastapi import Header, HTTPException

from .db import supabase


def _resolve_user(token: str) -> str:
    try:
        result = supabase.auth.get_claims(token)
    except Exception as exc:
        raise HTTPException(401, detail=f"get_claims failed: {type(exc).__name__}: {exc}")

    user_id = result and result.get("claims", {}).get("sub")

    if not user_id:
        raise HTTPException(401, detail=f"No sub in claims: {result!r}")

    return user_id


def get_current_user_id(authorization: str | None = Header(None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, detail="Missing bearer token")

    token = authorization.split(" ", 1)[1]
    return _resolve_user(token)


def get_user_id_from_token(token: str) -> str:
    return _resolve_user(token)
