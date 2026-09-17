"""The teacher's tool schema.

The model returns tool calls, not prose for us to parse. `stay_silent` exists
and must stay reachable: without it the model always says something, because
saying something is what it has been asked to do.

Deliberately flat and free of union types. An earlier version used
`["integer", "null"]` for the optional line numbers and produced malformed JSON
on ~7% of calls; optional-and-omitted generates far more reliably than
explicitly-null. Nothing nests, and nothing is required that the model could
reasonably want to leave out.
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
                        "description": "1-based line in the learner's buffer. Omit if none applies.",
                    },
                },
                "required": ["tier", "text"],
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
            "name": "translate_error",
            "description": (
                "Put a Python error in plain English. Only for errors the lookup "
                "table did not already recognise."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "plain_english": {"type": "string", "description": "One or two sentences."},
                    "target_line": {"type": "integer", "description": "Omit if none applies."},
                },
                "required": ["plain_english"],
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
