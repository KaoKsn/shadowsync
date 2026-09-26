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
                "icon-only controls, ambiguous layout). Costs an extra round "
                "trip -- don't use speculatively."
            ),
            "parameters": {"type": "object", "properties": {}},
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
    """Renders the current snapshot's elements for the prompt.

    The extension is responsible for filtering to viewport-visible
    elements before sending -- this function trusts that filter and just
    formats what it's given. If you ever see off-screen elements leaking
    through here, the bug is in the extension's scan stage, not here.
    """
    lines = []
    for el in snapshot.elements:
        value = f"[REDACTED:{el.redaction_reason}]" if el.redacted else (el.value or "-")
        lines.append(
            f"[{el.id}] <{el.tag}> role={el.role or '-'} "
            f"text={el.text or '-'} value={value}"
        )
    return "\n".join(lines) if lines else "(no visible elements)"
