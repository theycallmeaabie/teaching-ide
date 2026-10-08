"""server/auth.py — the only code path that decides who a caller is.

No network, no browser, no model. Run with `npm test auth`. The project's
public keys are generated here and served from a stub, never fetched.

The property that matters most is the first section: with nothing configured
the server must serve everything anonymously, because the editor, the observer
and the whole hint ladder are meant to run with nothing configured at all.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import importlib
import json
import os
import sys
import time
import warnings

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi import HTTPException
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

# A short test secret trips PyJWT's key-length advisory. Real Supabase secrets
# are long; this is noise here, not a finding.
warnings.filterwarnings("ignore", message=".*HMAC key.*")

SECRET = "test-secret-not-a-real-one-padded-to-length"
URL = "https://test-project.supabase.co"
ISS = f"{URL}/auth/v1"

EC_KEY = ec.generate_private_key(ec.SECP256R1())
RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
STRANGER = ec.generate_private_key(ec.SECP256R1())  # not the project's key


def jwk(private, algorithm, alg: str, kid: str) -> dict:
    return {**algorithm.to_jwk(private.public_key(), as_dict=True), "kid": kid, "alg": alg, "use": "sig"}


KEY_SET = {"keys": [jwk(EC_KEY, ECAlgorithm, "ES256", "ec-1"), jwk(RSA_KEY, RSAAlgorithm, "RS256", "rsa-1")]}

failures = 0


def reload_with(secret: str = "", url: str = ""):
    os.environ["SUPABASE_JWT_SECRET"] = secret
    os.environ["SUPABASE_URL"] = url
    from server import auth

    return importlib.reload(auth)


def serve_keys(auth, fail: bool = False) -> list[int]:
    """Answer the key-set fetch from here. Returns a list that counts fetches."""
    fetches: list[int] = []

    def fetch():
        fetches.append(1)
        if fail:
            raise jwt.PyJWKClientConnectionError("unreachable")
        return KEY_SET

    auth._jwks.fetch_data = fetch
    return fetches


def token(key=SECRET, alg: str = "HS256", kid: str | None = None, aud: str = "authenticated",
          exp_delta: int = 3600, sub: str | None = "user-123", iss: str | None = None) -> str:
    claims: dict = {"aud": aud, "exp": int(time.time()) + exp_delta}
    if sub is not None:
        claims["sub"] = sub
    if iss is not None:
        claims["iss"] = iss
    return jwt.encode(claims, key, algorithm=alg, headers={"kid": kid} if kid else None)


def es256(key=EC_KEY, kid: str = "ec-1", iss: str | None = ISS, **kw) -> str:
    return token(key, "ES256", kid=kid, iss=iss, **kw)


def hand_signed(header: dict, sign) -> str:
    """A token PyJWT would refuse to make, for the attacks it must refuse to accept."""
    def b64(d: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b"=").decode()

    claims = {"sub": "attacker", "aud": "authenticated", "iss": ISS, "exp": int(time.time()) + 3600}
    signing_input = f"{b64(header)}.{b64(claims)}"
    sig = base64.urlsafe_b64encode(sign(signing_input.encode())).rstrip(b"=").decode()
    return f"{signing_input}.{sig}"


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
auth = reload_with()
check("an HS256 token is ignored", lambda: auth.current_user(f"Bearer {token()}"), None)
check("an ES256 token is ignored", lambda: auth.current_user(f"Bearer {es256()}"), None)
check("no header is anonymous", lambda: auth.current_user(None), None)
check("ENABLED reports off", lambda: auth.ENABLED, False)

print()
print("--- Legacy secret: a presented identity must verify --------------")
auth = reload_with(secret=SECRET)
check("ENABLED reports on", lambda: auth.ENABLED, True)
check("no header is still served anonymously", lambda: auth.current_user(None), None)
check("a valid token yields the subject", lambda: auth.current_user(f"Bearer {token()}"), "user-123")
check("lower-case scheme is accepted", lambda: auth.current_user(f"bearer {token()}"), "user-123")
check("an expired token is rejected", lambda: auth.current_user(f"Bearer {token(exp_delta=-10)}"), "401")
check("another secret is rejected", lambda: auth.current_user(f"Bearer {token(key='wrong-secret-entirely')}"), "401")
check("the wrong audience is rejected", lambda: auth.current_user(f"Bearer {token(aud='other')}"), "401")
check("a non-bearer scheme is rejected", lambda: auth.current_user("Basic abc"), "401")
check("an empty bearer is rejected", lambda: auth.current_user("Bearer "), "401")
check("rubbish in place of a token is rejected", lambda: auth.current_user("Bearer not.a.jwt"), "401")
check("a token with no subject is anonymous", lambda: auth.current_user(f"Bearer {token(sub=None)}"), None)
check("an ES256 token is rejected: no keys configured", lambda: auth.current_user(f"Bearer {es256()}"), "401")

print()
print("--- Public keys: what new Supabase projects issue ----------------")
auth = reload_with(url=URL + "/")
fetches = serve_keys(auth)
check("ENABLED reports on with only the URL", lambda: auth.ENABLED, True)
check("a trailing slash on the URL is ignored", lambda: auth.ISSUER, ISS)
check("a valid ES256 token yields the subject", lambda: auth.current_user(f"Bearer {es256()}"), "user-123")
check("a valid RS256 token yields the subject",
      lambda: auth.current_user(f"Bearer {token(RSA_KEY, 'RS256', kid='rsa-1', iss=ISS)}"), "user-123")
check("the key set is fetched once, then cached", lambda: len(fetches), 1)
check("no header is still served anonymously", lambda: auth.current_user(None), None)
check("a token with no subject is anonymous", lambda: auth.current_user(f"Bearer {es256(sub=None)}"), None)
check("another key under the project's key id is rejected",
      lambda: auth.current_user(f"Bearer {es256(key=STRANGER)}"), "401")
check("an unknown key id is rejected", lambda: auth.current_user(f"Bearer {es256(kid='nope')}"), "401")
check("an expired token is rejected", lambda: auth.current_user(f"Bearer {es256(exp_delta=-10)}"), "401")
check("the wrong audience is rejected", lambda: auth.current_user(f"Bearer {es256(aud='other')}"), "401")
check("another project's issuer is rejected",
      lambda: auth.current_user(f"Bearer {es256(iss='https://other.supabase.co/auth/v1')}"), "401")
check("a token with no issuer is rejected", lambda: auth.current_user(f"Bearer {es256(iss=None)}"), "401")
check("an ES256 token naming the RS256 key is rejected",
      lambda: auth.current_user(f"Bearer {es256(kid='rsa-1')}"), "401")
check("an HS256 token is rejected: no secret configured", lambda: auth.current_user(f"Bearer {token()}"), "401")
check("an unsigned token is rejected",
      lambda: auth.current_user(f"Bearer {hand_signed({'alg': 'none', 'kid': 'ec-1'}, lambda _: b'')}"), "401")
for i in range(5):
    try:
        auth.current_user(f"Bearer {es256(kid=f'made-up-{i}')}")
    except HTTPException:
        pass
check("made-up key ids refetch at most once per cooldown", lambda: len(fetches) <= 2, True)

auth = reload_with(url=URL)
serve_keys(auth, fail=True)
check("unreachable keys are a 503, not a verdict on the token",
      lambda: auth.current_user(f"Bearer {es256()}"), "503")

print()
print("--- Both: a project part-way through rotating ---------------------")
auth = reload_with(secret=SECRET, url=URL)
serve_keys(auth)
check("a legacy HS256 token still verifies", lambda: auth.current_user(f"Bearer {token()}"), "user-123")
check("an ES256 token verifies", lambda: auth.current_user(f"Bearer {es256()}"), "user-123")
public_pem = EC_KEY.public_key().public_bytes(
    serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
)
check("HS256 signed with the public key is rejected",
      lambda: auth.current_user(
          f"Bearer {hand_signed({'alg': 'HS256', 'kid': 'ec-1'}, lambda m: hmac.new(public_pem, m, hashlib.sha256).digest())}"
      ), "401")

print()
if failures:
    print(f"{failures} FAILED")
    sys.exit(1)
print("ALL AUTH CASES PASSED")
