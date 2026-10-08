"""The teacher's tool schema.

The model returns tool calls, not prose for us to parse. `stay_silent` exists
and must stay reachable: without it the model always says something, because
saying something is what it has been asked to do.

Deliberately flat and free of union types. An earlier version used
`["integer", "null"]` for the optional line numbers and produced malformed JSON
on ~7% of calls.

Leaving them optional did not fix it either: the model reaches for `null` to
say "no particular line" whichever way the schema is written, and the provider
then rejects the whole call with `expected integer, but got null`. Measured at
22% of calls on openai/gpt-oss-120b. So the line numbers are now *required*
integers with 0 meaning "no single line" — the model always has something
legal to emit, and null is unreachable. The client reads anything below 1 as
no line. Nothing nests, and nothing is required that the model could not
answer.

`explain` follows the same rule: its `example` and `followup_question` are
required strings, empty when unused, never optional and never null.
"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "give_hint",
            "description": (
                "Offer the next rung of the hint ladder. Never skip ahead of the "
                "tier you were told to use, and never include the finished answer "
                "below tier 5."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "tier": {
                        "type": "integer",
                        "description": "1-5. Must equal the current tier you were given.",
                    },
                    "text": {
                        "type": "string",
                        "description": "Two to three sentences, maximum. Speak to a beginner.",
                    },
                    "target_line": {
                        "type": "integer",
                        "description": (
                            "1-based line in the learner's buffer that the hint is "
                            "about, or 0 if it is not about one particular line."
                        ),
                    },
                },
                "required": ["tier", "text", "target_line"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_question",
            "description": (
                "Ask the learner one concrete question instead of telling them "
                "anything. Use this when they asked for the answer outright."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "One question. Two sentences at most."}
                },
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "explain",
            "description": (
                "Explain an idea they asked about, such as what a keyword is, how a "
                "concept works, or why something behaves as it does. This is "
                "teaching, and teaching is free. What is NOT free is the answer "
                "to their exercise: never explain in a way that hands it over."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Up to five sentences. Plain words, for a beginner.",
                    },
                    "example": {
                        "type": "string",
                        "description": (
                            "A tiny code example on a DIFFERENT problem from theirs, "
                            "or an empty string if none would help."
                        ),
                    },
                    "followup_question": {
                        "type": "string",
                        "description": (
                            "One short question to check it landed, or an empty "
                            "string if it is not needed."
                        ),
                    },
                },
                "required": ["text", "example", "followup_question"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "translate_error",
            "description": (
                "Put a Python error in plain English. Only for errors the lookup "
                "table did not already recognise."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "plain_english": {"type": "string", "description": "One or two sentences."},
                    "target_line": {
                        "type": "integer",
                        "description": "1-based line, or 0 if no single line applies.",
                    },
                },
                "required": ["plain_english", "target_line"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "confirm_success",
            "description": "They got it. Confirm briefly, then usually ask why it worked.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "One sentence."},
                    "followup_question": {"type": "string", "description": "Omit if none."},
                },
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "stay_silent",
            "description": (
                "Say nothing. Correct whenever the learner is making progress, is "
                "mid-thought, or the moment is wrong. Silence is a real choice."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "description": "Why silence is right here. One short sentence.",
                    }
                },
                "required": ["reason"],
            },
        },
    },
]

TOOL_NAMES = {t["function"]["name"] for t in TOOLS}
