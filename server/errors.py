"""Plain-English translation for the errors beginners actually hit.

Most error translation is a dictionary, not inference. This runs before the
model is involved at all: it costs nothing, it is instant, and it is right every
time. Only errors that fall through here are worth a token.
"""

from __future__ import annotations

import re
from typing import Callable, NamedTuple


class Translation(NamedTuple):
    plain_english: str
    line: int | None


class _Rule(NamedTuple):
    error_type: str
    pattern: re.Pattern[str]
    render: Callable[[re.Match[str]], str]


def _rule(error_type: str, pattern: str, render: Callable[[re.Match[str]], str]) -> _Rule:
    return _Rule(error_type, re.compile(pattern), render)


def _a(word: str) -> str:
    """"a int" reads as carelessness to a beginner. It is one line to not do."""
    return f"{'an' if word[:1].lower() in 'aeiou' else 'a'} {word}"


RULES: list[_Rule] = [
    _rule(
        "IndentationError",
        r"expected an indented block after '(?P<kw>\w+)' statement",
        lambda m: (
            f"The lines that belong inside your {m['kw']} need to be pushed in from the left. "
            "Python uses that indent to know what is inside and what is outside."
        ),
    ),
    _rule(
        "IndentationError",
        r"unexpected indent",
        lambda m: (
            "This line is pushed in further than Python expected. "
            "It should line up with the line above it."
        ),
    ),
    _rule(
        "IndentationError",
        r"unindent does not match",
        lambda m: (
            "This line is pulled back to a position that does not line up with anything above it. "
            "Every indent has to match one that came before."
        ),
    ),
    _rule(
        "TabError",
        r".",
        lambda m: (
            "Some lines are indented with tabs and others with spaces. "
            "Python cannot tell how deep they are. Use spaces for all of them."
        ),
    ),
    _rule(
        "SyntaxError",
        r"expected ':'",
        lambda m: "Python needs a colon at the end of this line — for example `for n in nums:`.",
    ),
    _rule(
        "SyntaxError",
        r"invalid syntax",
        lambda m: (
            "Python could not make sense of this line. Check for a missing colon, "
            "a missing bracket, or a stray character."
        ),
    ),
    _rule(
        "SyntaxError",
        r"'\(' was never closed|unexpected EOF",
        lambda m: "A bracket was opened here and never closed.",
    ),
    _rule(
        "NameError",
        r"name '(?P<name>[^']+)' is not defined",
        lambda m: (
            f"Python has never seen `{m['name']}` before this line. "
            "Either it is spelled differently from where you created it, or it has not been created yet."
        ),
    ),
    _rule(
        "IndexError",
        r"list index out of range",
        lambda m: (
            "You asked the list for a position it does not have. "
            "A list of four items has positions 0, 1, 2 and 3 — there is no position 4."
        ),
    ),
    _rule(
        "TypeError",
        r"can only concatenate str \(not \"(?P<other>\w+)\"\) to str",
        lambda m: (
            f"You are joining text and {_a(m['other'])} with `+`. Python will not mix the two — "
            "either make them both text, or both numbers."
        ),
    ),
    _rule(
        "TypeError",
        r"unsupported operand type\(s\) for (?P<op>\S+): '(?P<a>\w+)' and '(?P<b>\w+)'",
        lambda m: (
            f"You are trying to use `{m['op']}` between {_a(m['a'])} and {_a(m['b'])}. "
            "Python does not know what that would mean."
        ),
    ),
    _rule(
        "TypeError",
        r"'(?P<what>\w+)' object is not iterable",
        lambda m: (
            f"A `for` loop needs something with several items in it, and this is a single {m['what']}. "
            "Check that you are looping over the list itself."
        ),
    ),
    _rule(
        "TypeError",
        r"'(?P<what>\w+)' object is not subscriptable",
        lambda m: (
            f"Square brackets ask for an item at a position, but {_a(m['what'])} does not have positions."
        ),
    ),
    _rule(
        "AttributeError",
        r"'(?P<what>\w+)' object has no attribute '(?P<attr>[^']+)'",
        lambda m: f"{_a(m['what']).capitalize()} has no `{m['attr']}`. That only works on a different kind of value.",
    ),
    _rule(
        "ZeroDivisionError",
        r".",
        lambda m: "Something was divided by zero, which has no answer.",
    ),
    _rule(
        "EOFError",
        r".",
        lambda m: "`input()` does not work in this editor — there is nowhere to type an answer.",
    ),
]


def translate(error_type: str, message: str, line: int | None) -> Translation | None:
    """Return a plain-English reading, or None if this one needs the model."""
    for rule in RULES:
        if rule.error_type != error_type:
            continue
        if rule.pattern.search(message):
            return Translation(rule.render(rule.pattern.search(message)), line)  # type: ignore[arg-type]
    return None
