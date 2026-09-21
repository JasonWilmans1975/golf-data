import json

import jwt
from fastapi import Header, HTTPException
from jwt.algorithms import ECAlgorithm

# Supabase's public JWT signing key (ES256), from
# <SUPABASE_URL>/auth/v1/.well-known/jwks.json. This is a PUBLIC key,
# safe to embed. Fetching it at request time from Render was hitting a
# persistent network error talking to Supabase's auth service, so it's
# embedded statically instead. If Supabase ever rotates this signing
# key, it needs to be refreshed from the JWKS endpoint above.
_JWK = {
    "alg": "ES256",
    "crv": "P-256",
    "ext": True,
    "key_ops": ["verify"],
    "kid": "fdc71a91-f54a-4af8-b2be-773ca1f5f3ba",
    "kty": "EC",
    "use": "sig",
    "x": "psgnANbvXiyY1uNlVJDqvMFHTmJWsgAlwaMLygPYHN8",
    "y": "oi7AlixYHurRnf7GFG1cA6cO2hmbSghZiMHF7kat3yQ",
}

_PUBLIC_KEY = ECAlgorithm.from_jwk(json.dumps(_JWK))


def _resolve_user(token: str) -> str:
    try:
        payload = jwt.decode(
            token,
            _PUBLIC_KEY,
            algorithms=["ES256"],
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
