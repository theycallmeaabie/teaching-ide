"""Server-side limits on /api/teach.

The interruption budget used to live only in the browser, so anyone who could
reach the API could spend the provider's tokens without limit. Three limits,
all per *principal* — the signed-in user if there is one, otherwise the
caller's address:

  - calls per minute        stops a script or a stuck loop hammering the model
  - calls per day           bounds what one person can cost
  - spoken interruptions per sitting
                            the same budget the learner's own browser keeps

The first two are cost controls and hold whatever the caller says about
itself. The third is not one: a sitting is identified by an id the client
chooses, so a client that wants to can start a new one on every call. It keeps
the observer polite to an honest learner — the same tally their browser keeps,
and the one that survives a refresh or a second tab — and nothing more. Do not
mistake it for protection.

Limits are never errors the learner sees. A refused call comes back as a normal
decision — pre-written rung, or deliberate silence — because the lesson never
stalls. That is also why this is in-memory: it is a guard rail, not accounting,
and a restart resetting the counters costs nothing worse than a fresh minute.

Single process only. Run more than one worker and each keeps its own counters,
so the effective limits multiply. Put Redis behind this if that matters.
"""

from __future__ import annotations

import os
import time
from collections import deque
from dataclasses import dataclass

from fastapi import Request

PER_MINUTE = int(os.environ.get("TEACH_PER_MINUTE", "10"))
PER_DAY = int(os.environ.get("TEACH_PER_DAY", "400"))
#: Matches the observer's default `budget`, which is a tunable on the client.
GATE_BUDGET = int(os.environ.get("TEACH_GATE_BUDGET", "8"))
#: Behind a reverse proxy every caller shares the proxy's address. Turn this on
#: only when one you control is in front, or callers can spoof their own.
TRUST_PROXY = os.environ.get("TRUST_PROXY", "0") == "1"

#: Bound on tracked principals, so a flood of distinct addresses cannot grow
#: memory without limit.
MAX_TRACKED = 20_000

_minute: dict[str, deque[float]] = {}
_day: dict[str, tuple[int, int]] = {}  # principal -> (day number, calls)
_spoken: dict[tuple[str, str], int] = {}  # (principal, session) -> interruptions


@dataclass(frozen=True)
class Verdict:
    ok: bool
    #: "rate" -> serve the pre-written rung; "budget" -> stay silent.
    kind: str | None = None
    reason: str | None = None


def principal(user_id: str | None, request: Request) -> str:
    if user_id:
        return f"user:{user_id}"
    ip = request.client.host if request.client else "unknown"
    if TRUST_PROXY:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            ip = fwd.split(",")[0].strip() or ip
    return f"ip:{ip}"


def _prune() -> None:
    if len(_minute) > MAX_TRACKED:
        cutoff = time.monotonic() - 60
        for k in [k for k, q in _minute.items() if not q or q[-1] < cutoff]:
            _minute.pop(k, None)
    if len(_day) > MAX_TRACKED:
        today = int(time.time() // 86400)
        for k in [k for k, (d, _) in _day.items() if d != today]:
            _day.pop(k, None)
    if len(_spoken) > MAX_TRACKED:
        _spoken.clear()  # sittings are short; losing them forgives, never blocks


def check(who: str, session_id: str | None, trigger: str, *, billable: bool = True) -> Verdict:
    """Decide whether this call may be answered. Records it if so.

    `billable` is False for an answer served from the cache: it costs the
    provider nothing, so it does not count against the rate limits — but the
    interruption budget is about the learner's experience, not cost, so it
    applies either way.
    """
    _prune()

    # Only the observer's own interruptions spend the budget. A learner's
    # question is never refused for it. Checked first: silence is the cheaper
    # and more honest answer than a rate-limit message.
    if trigger == "gate" and _spoken.get((who, session_id or ""), 0) >= GATE_BUDGET:
        return Verdict(False, "budget", f"interruption budget of {GATE_BUDGET} spent for this sitting")

    if not billable:
        return Verdict(True)

    now = time.monotonic()
    q = _minute.setdefault(who, deque())
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= PER_MINUTE:
        return Verdict(False, "rate", f"rate limited: more than {PER_MINUTE} calls a minute")

    today = int(time.time() // 86400)
    day, n = _day.get(who, (today, 0))
    if day != today:
        day, n = today, 0
    if n >= PER_DAY:
        return Verdict(False, "rate", f"rate limited: daily limit of {PER_DAY} calls reached")

    q.append(now)
    _day[who] = (day, n + 1)
    return Verdict(True)


def note_spoke(who: str, session_id: str | None, trigger: str) -> None:
    """Charge the sitting's budget — only when the teacher actually said
    something. Choosing silence interrupted nobody and costs nothing."""
    if trigger != "gate":
        return
    key = (who, session_id or "")
    _spoken[key] = _spoken.get(key, 0) + 1


def reset() -> None:
    """For tests."""
    _minute.clear()
    _day.clear()
    _spoken.clear()
