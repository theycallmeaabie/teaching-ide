"""Disk cache for model responses, keyed on the exact request context.

Tuning the observer means sending near-identical context hundreds of times, and
the daily token cap is roughly two full sessions' worth. Identical input replays
from disk instead of spending tokens on an answer we already have.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any

CACHE_DIR = Path(__file__).parent / ".cache"
ENABLED = os.environ.get("LLM_CACHE", "1") != "0"


def key(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode())
        h.update(b"\x00")
    return h.hexdigest()[:32]


def get(k: str) -> dict[str, Any] | None:
    if not ENABLED:
        return None
    path = CACHE_DIR / f"{k}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def put(k: str, value: dict[str, Any]) -> None:
    if not ENABLED:
        return
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        (CACHE_DIR / f"{k}.json").write_text(json.dumps(value))
    except OSError:
        pass


def stats() -> dict[str, Any]:
    if not CACHE_DIR.exists():
        return {"enabled": ENABLED, "entries": 0}
    return {"enabled": ENABLED, "entries": len(list(CACHE_DIR.glob("*.json")))}
