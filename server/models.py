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


class TeachRequest(BaseModel):
    #: The document version this context was generated from. Echoed back so the
    #: client can throw the answer away if the learner has moved on.
    doc_version: int
    buffer: str
    exercise_id: str
    exercise_prompt: str
    expected_stdout: str

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
    learner_question: str | None = None

    #: Last three only. Never the full transcript.
    recent: list[Interaction] = []


class TeachResponse(BaseModel):
    doc_version: int
    tool: str
    args: dict
    #: Where the words came from, so the UI can say so and the log can record it.
    source: Literal["llm", "prewritten", "lookup"]
    #: Populated when we had to fall back.
    note: str | None = None
