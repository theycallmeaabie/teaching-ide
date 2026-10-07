"""Request/response shapes. Kept small on purpose: Groq has no prompt caching,
so every token in here is paid for on every single call."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class RunErrorIn(BaseModel):
    type: str
    message: str
    line: int | None = None


class RunResultIn(BaseModel):
    ok: bool
    stdout: str = ""
    error: RunErrorIn | None = None
    #: Did it actually solve the exercise? Clean-but-wrong is not success.
    correct: bool = False


class Interaction(BaseModel):
    role: Literal["teacher", "learner"]
    text: str


class LearnerProfile(BaseModel):
    """Who this learner has been so far, across every exercise.

    Computed on the client from saved progress and sent in a few lines. It is
    what lets the teacher pitch a hint for *this* person rather than for an
    average one: the exercise they struggled on, the mistake they keep making,
    whether they reach for the answer.
    """

    solved: int = 0
    total: int = 0
    #: Titles of exercises that took real effort (deep on the ladder, or many
    #: attempts). The most recent few — not a history.
    struggled: list[str] = []
    #: Plain-English names of misconceptions seen in more than one exercise.
    recurring: list[str] = []
    #: Sections finished without needing more than a nudge.
    comfortable: list[str] = []
    #: Times they have asked to simply be told the answer, over all exercises.
    begs: int = 0


class TeachRequest(BaseModel):
    #: The document version this context was generated from. Echoed back so the
    #: client can throw the answer away if the learner has moved on.
    doc_version: int
    buffer: str = Field(max_length=8000)
    exercise_id: str
    exercise_prompt: str
    expected_stdout: str
    #: The topic, not the mechanics — see lesson/exercises.ts.
    exercise_concept: str = ""
    exercise_section: str = ""

    tier: int = Field(ge=1, le=5)
    #: All five rungs, so the model can see where it is on the ladder and not
    #: wander down it. Only the current one may be revealed.
    tier_texts: list[str] = []
    attempts: int = 0

    last_run: RunResultIn | None = None
    misconceptions: list[str] = []
    misconception_notes: list[str] = []

    #: How many times they have asked to just be told the answer.
    asked_for_answer: int = 0
    #: What the observer measured. Given to the model so "are they mid-thought"
    #: is a fact it can check rather than a vibe it has to guess.
    idle_ms: int = 0
    last_edit_ms_ago: int | None = None
    stuck_score: float = 0.0
    trigger: Literal["gate", "ask", "success"] = "gate"
    learner_question: str | None = Field(default=None, max_length=1000)

    #: The conversation on this exercise, oldest first. The client keeps the
    #: whole thread; the prompt uses the tail of it.
    recent: list[Interaction] = Field(default_factory=list, max_length=40)

    profile: LearnerProfile | None = None

    #: The last hint was given and the code has not changed since. Whatever was
    #: said did not land, so saying it again, louder, is the one wrong move.
    previous_hint_failed: bool = False

    #: One per page load. Lets the server count interruptions per sitting.
    session_id: str | None = Field(default=None, max_length=64)


class TeachResponse(BaseModel):
    doc_version: int
    tool: str
    args: dict
    #: Where the words came from, so the UI can say so and the log can record it.
    source: Literal["llm", "prewritten", "lookup"]
    #: Populated when we had to fall back.
    note: str | None = None
