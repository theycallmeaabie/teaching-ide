"""Stops the teacher from handing over the answer early.

Clamping the tier number is not enough: the model will happily return
`tier: 2` with tier-5 content inside it, and it did exactly that on the first
live call. "Never give the answer before tier 5" is the product, so it is
enforced here rather than requested in the prompt.

The forbidden fragments are derived from the lesson content itself — tier 5 is
by definition the rung that spells out the code, so anything that looks like
code in the tier-5 text is what the earlier rungs must not contain. Nothing is
configured per exercise.
"""

from __future__ import annotations

import re

#: An assignment, an augmented assignment, or a call. Enough to catch
#: `total = 0`, `total = total + n`, `count += 1`, `print(total)`.
_CODE = re.compile(
    r"[A-Za-z_]\w*\s*(?:\+=|-=|=)\s*[A-Za-z_0-9][\w\s+\-*/]*"
    r"|[A-Za-z_]\w*\([^)]*\)"
)

_MIN_FRAGMENT = 5

#: An assignment of a bare number, e.g. `total = 0` or `count = 0`. These are
#: the lines beginners have to place correctly, so they are also the ones the
#: teacher most wants to blurt out.
_INIT = re.compile(r"(?P<name>[A-Za-z_]\w{3,})\s*=\s*(?P<value>\d+)\b")

#: How close the name and the number have to be for the prose to count as
#: having handed over the line.
_PROXIMITY = 40


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("`", "")).strip().lower()


def forbidden_fragments(tier_texts: list[str]) -> list[str]:
    """Code fragments that only tier 5 is allowed to say out loud."""
    if len(tier_texts) < 5:
        return []
    out: list[str] = []
    for m in _CODE.finditer(_norm(tier_texts[4])):
        frag = m.group(0).strip().rstrip(".,")
        if len(frag) >= _MIN_FRAGMENT:
            out.append(frag)
    return out


def forbidden_pairs(tier_texts: list[str]) -> list[tuple[str, str]]:
    """(variable, number) pairs that tier 5 spells out, e.g. ("total", "0")."""
    if len(tier_texts) < 5:
        return []
    return [(m["name"], m["value"]) for m in _INIT.finditer(_norm(tier_texts[4]))]


def leaks(text: str, tier: int, tier_texts: list[str]) -> str | None:
    """Return the offending fragment, or None if the text is safe to show.

    Two passes. The first catches code they could paste. The second catches the
    same line said out loud — "the line that sets total to 0" hands over exactly
    as much as `total = 0` does, and the model reaches for it when a learner has
    asked to be told three times.
    """
    if tier >= 5:
        return None
    haystack = _norm(text)

    for frag in forbidden_fragments(tier_texts):
        if frag in haystack:
            return frag

    for name, value in forbidden_pairs(tier_texts):
        for m in re.finditer(re.escape(name), haystack):
            window = haystack[m.start() : m.start() + _PROXIMITY]
            if re.search(rf"\b{re.escape(value)}\b", window):
                return f"{name} … {value}"
    return None


# --------------------------------------------------------------- instructions

#: Verbs that tell someone to DO something to their program. At the first two
#: rungs a teacher describes where to look and what is wrong; once it says
#: "create a variable before the loop, then add each number to it" it has said
#: the whole solution in words, and no code fragment appears for `leaks` to
#: find. Measured on the live model: the first hint it gave on the accumulator
#: exercise did exactly this.
_ACTIONS = (
    r"create|creating|add|adding|move|moving|put|putting|set|setting|write|writing|"
    r"change|changing|replace|replacing|insert|inserting|declare|declaring|"
    r"define|defining|initiali[sz]e|initiali[sz]ing|assign|assigning|"
    r"start with|starting with"
)

#: An action verb is an instruction when it opens a sentence or follows a
#: connective that carries one ("then add", "you need to put", "try creating").
#: Mid-sentence description — "line 4 adds the number" — is not matched, because
#: describing what code does is the job.
_INSTRUCTION = re.compile(
    rf"(?:^|[.!?:]\s+|\b(?:then|and|also|just|first|next|should|must|need to|have to|try to|try|by)\s+)"
    rf"(?P<verb>{_ACTIONS})\b",
    re.IGNORECASE,
)

#: Rungs 3 and up may explain the mechanism; rungs 1 and 2 may not instruct.
_INSTRUCTION_FREE_TIERS = 2


def instructs(text: str, tier: int) -> str | None:
    """Return the instruction found, or None.

    The hand-written ladder holds itself to the same rule — see
    `/api/check-ladder` — so this is not a stricter standard than the one the
    lesson was written to, only the same one applied to the model.
    """
    if tier > _INSTRUCTION_FREE_TIERS:
        return None
    m = _INSTRUCTION.search(" ".join(text.split()))
    return m.group(0).strip(" .!?:").lower() if m else None
