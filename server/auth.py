"""Supabase JWT verification.

Optional by design. With `SUPABASE_JWT_SECRET` unset the server accepts every
call anonymously, exactly as it did before auth existed — the editor, the
observer and the whole hint ladder are meant to run with nothing configured.

When the secret *is* set:
  - no `Authorization` header  -> anonymous, still served
  - a valid bearer token       -> the Supabase user id
  - a malformed or expired one -> 401

The last case is deliberate. A caller who presents a token is claiming an
identity; silently downgrading that to anonymous would hide a broken client.
"""

from __future__ import annotations

import os

import jwt
from dotenv import load_dotenv
from fastapi import Header, HTTPException

load_dotenv()

JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
# Supabase signs user tokens with this audience unless the project overrides it.
JWT_AUDIENCE = os.environ.get("SUPABASE_JWT_AUDIENCE", "authenticated")

ENABLED = bool(JWT_SECRET)


def current_user(authorization: str | None = Header(default=None)) -> str | None:
    """FastAPI dependency. Returns the Supabase user id, or None if anonymous."""
    if not ENABLED or not authorization:
        return None

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="malformed Authorization header")

    try:
        claims = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=["HS256"],
            audience=JWT_AUDIENCE,
        )
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"invalid token: {type(e).__name__}") from e

    sub = claims.get("sub")
    return str(sub) if sub else None
