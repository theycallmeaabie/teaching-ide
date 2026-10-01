"""server/auth.py — the only code path that decides who a caller is.

No network, no browser, no model. Run with `npm test auth`.

The property that matters most is the first pair: with the secret unset the
server must serve everything anonymously, because the editor, the observer and
the whole hint ladder are meant to run with nothing configured at all.
"""

from __future__ import annotations

import importlib
import os
import sys
import time
import warnings

import jwt
from fastapi import HTTPException

# A short test secret trips PyJWT's key-length advisory. Real Supabase secrets
# are long; this is noise here, not a finding.
warnings.filterwarnings("ignore", message=".*HMAC key.*")

SECRET = "test-secret-not-a-real-one-padded-to-length"

failures = 0


def reload_with(secret: str):
    os.environ["SUPABASE_JWT_SECRET"] = secret
    from server import auth

    return importlib.reload(auth)


def token(secret: str = SECRET, aud: str = "authenticated", exp_delta: int = 3600,
          sub: str | None = "user-123") -> str:
    claims: dict = {"aud": aud, "exp": int(time.time()) + exp_delta}
    if sub is not None:
        claims["sub"] = sub
    return jwt.encode(claims, secret, algorithm="HS256")


def check(label, fn, want):
    global failures
    try:
        got = fn()
    except HTTPException as e:
        got = str(e.status_code)
    ok = got == want
    if not ok:
        failures += 1
    print(f"{'PASS' if ok else 'FAIL'}  {label}  — {got!r}")


print("--- Unconfigured: everything is anonymous ------------------------")
auth = reload_with("")
check("a token is ignored when no secret is set", lambda: auth.current_user(f"Bearer {token()}"), None)
check("no header is anonymous", lambda: auth.current_user(None), None)
check("ENABLED reports off", lambda: auth.ENABLED, False)

print()
print("--- Configured: a presented identity must verify -----------------")
auth = reload_with(SECRET)
check("ENABLED reports on", lambda: auth.ENABLED, True)
check("no header is still served anonymously", lambda: auth.current_user(None), None)
check("a valid token yields the subject", lambda: auth.current_user(f"Bearer {token()}"), "user-123")
check("lower-case scheme is accepted", lambda: auth.current_user(f"bearer {token()}"), "user-123")
check("an expired token is rejected", lambda: auth.current_user(f"Bearer {token(exp_delta=-10)}"), "401")
check("another secret is rejected", lambda: auth.current_user(f"Bearer {token(secret='wrong-secret-entirely')}"), "401")
check("the wrong audience is rejected", lambda: auth.current_user(f"Bearer {token(aud='other')}"), "401")
check("a non-bearer scheme is rejected", lambda: auth.current_user("Basic abc"), "401")
check("an empty bearer is rejected", lambda: auth.current_user("Bearer "), "401")
check("rubbish in place of a token is rejected", lambda: auth.current_user("Bearer not.a.jwt"), "401")
check("a token with no subject is anonymous", lambda: auth.current_user(f"Bearer {token(sub=None)}"), None)

print()
if failures:
    print(f"{failures} FAILED")
    sys.exit(1)
print("ALL AUTH CASES PASSED")
