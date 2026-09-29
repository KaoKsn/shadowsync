"""OpenAI tool/function definitions used by the `act` node, plus the
prompt-rendering helper for the current snapshot.

Every action the model can take is a tool call with a strict schema --
nothing here is parsed out of free text. That's deliberate: it's the
fix for logic living outside the graph in a way nobody can trace.
"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "click",
            "description": "Click an interactive element identified by its id.",
            "parameters": {
                "type": "object",
                "properties": {"target_id": {"type": "integer"}},
                "required": ["target_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "type_text",
            "description": "Type text into an input/textarea identified by its id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_id": {"type": "integer"},
                    "text": {"type": "string"},
                },
                "required": ["target_id", "text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "scroll",
            "description": (
                "Scroll the page. Use this to reveal elements that are not "
                "currently in the viewport -- you only ever see visible "
                "elements, so scroll rather than assuming something exists "
                "off-screen."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "direction": {"type": "string", "enum": ["up", "down"]}
                },
                "required": ["direction"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "request_screenshot",
            "description": (
                "Request a redacted screenshot when the visible DOM elements "
                "genuinely aren't enough to decide the next action (e.g. "
                "icon-only controls, ambiguous layout). The returned "
                "screenshot is paired with the same numbered DOM payload, "
                "so the model can map what it sees back to the element ids. "
                "Costs an extra round trip -- don't use speculatively."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "request_user_input",
            "description": (
                "Use when the page becomes a login, signup, verification, "
                "account-creation, consent, or other PII-sensitive form that "
                "cannot be completed safely from DOM context alone. Ask the "
                "frontend to pause the agent and prompt the human user to "
                "enter the required information locally, then continue after "
                "the form is submitted and a fresh snapshot is sent back. Do "
                "not guess or fabricate passwords, OTPs, emails, phone "
                "numbers, addresses, or other sensitive values."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Short instruction for the frontend to show the user.",
                    }
                },
                "required": ["message"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "summarize_page",
            "description": (
                "Use when the task is to summarize/describe the current "
                "page rather than perform an action on it."
            ),
            "parameters": {
                "type": "object",
                "properties": {"summary": {"type": "string"}},
                "required": ["summary"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "task_complete",
            "description": "Call when the original task has been fully accomplished.",
            "parameters": {
                "type": "object",
                "properties": {"summary": {"type": "string"}},
                "required": ["summary"],
            },
        },
    },
]


def render_snapshot_for_prompt(snapshot) -> str:
    lines = []
    for el in snapshot.elements:
        value = f"[REDACTED:{el.redaction_reason}]" if el.redacted else (el.value or "-")
        lines.append(
            f"[{el.mark_id}] <{el.tag}> role={el.role or '-'} "   # was: el.id
            f"text={el.text or '-'} value={value}"
        )
    return "\n".join(lines) if lines else "(no visible elements)"
