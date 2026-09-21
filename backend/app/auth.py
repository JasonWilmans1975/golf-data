import jwt
from fastapi import Header, HTTPException
from jwt import PyJWKClient

from .config import settings

_jwks_url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
_jwks_client = PyJWKClient(_jwks_url)


def _resolve_user(token: str) -> str:
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
        )
    except Exception:
        raise HTTPException(401, detail="Invalid or expired session")

    user_id = payload.get("sub")

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
