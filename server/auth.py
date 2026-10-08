"""Supabase JWT verification.

Optional by design. With neither `SUPABASE_URL` nor `SUPABASE_JWT_SECRET` set
the server accepts every call anonymously, exactly as it did before auth
existed — the editor, the observer and the whole hint ladder are meant to run
with nothing configured.

Supabase signs user tokens one of two ways, and each token's header says which:
  - ES256 or RS256, the default for new projects: checked against the
    project's public keys, fetched from `SUPABASE_URL`. Nothing secret.
  - HS256, the legacy scheme: checked with `SUPABASE_JWT_SECRET`.

When either is configured:
  - no `Authorization` header  -> anonymous, still served
  - a valid bearer token       -> the Supabase user id
  - a malformed or expired one,
    or one signed a way that is not configured -> 401
  - the public keys cannot be fetched -> 503

The 401 is deliberate. A caller who presents a token is claiming an identity;
silently downgrading that to anonymous would hide a broken client.
"""

from __future__ import annotations

import os

import jwt
from dotenv import load_dotenv
from fastapi import Header, HTTPException

load_dotenv()

JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")
# The server's own setting, deliberately not VITE_SUPABASE_URL: the browser can
# sign in against a project (or a test's fake one) without the API starting to
# reject tokens nobody told it how to check.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
# Supabase signs user tokens with this audience unless the project overrides it.
JWT_AUDIENCE = os.environ.get("SUPABASE_JWT_AUDIENCE", "authenticated")
ISSUER = f"{SUPABASE_URL}/auth/v1"

# HS256 is never looked up in the key set: a public key must not be usable as
# an HMAC secret.
ASYMMETRIC = ("ES256", "RS256")

# The key set is cached for five minutes, and refetched sooner when a token
# names a key it has not seen (a rotation), at most once per 30 seconds, so
# made-up key ids cannot turn into a flood of fetches.
_jwks = (
    jwt.PyJWKClient(f"{ISSUER}/.well-known/jwks.json", lifespan=300, timeout=5)
    if SUPABASE_URL
    else None
)

ENABLED = bool(JWT_SECRET or _jwks)


def _claims(token: str) -> dict:
    alg = jwt.get_unverified_header(token).get("alg")
    if alg == "HS256" and JWT_SECRET:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"], audience=JWT_AUDIENCE)
    if alg in ASYMMETRIC and _jwks:
        key = _jwks.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            key.key,
            algorithms=[key.algorithm_name],
            audience=JWT_AUDIENCE,
            issuer=ISSUER,
        )
    raise jwt.InvalidAlgorithmError(f"{alg} tokens are not verified here")


def current_user(authorization: str | None = Header(default=None)) -> str | None:
    """FastAPI dependency. Returns the Supabase user id, or None if anonymous."""
    if not ENABLED or not authorization:
        return None

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="malformed Authorization header")

    try:
        claims = _claims(token)
    except jwt.PyJWKClientConnectionError as e:
        # Supabase is unreachable, which says nothing about the token.
        raise HTTPException(status_code=503, detail="cannot fetch signing keys") from e
    except jwt.PyJWTError as e:
        raise HTTPException(status_code=401, detail=f"invalid token: {type(e).__name__}") from e

    sub = claims.get("sub")
    return str(sub) if sub else None
