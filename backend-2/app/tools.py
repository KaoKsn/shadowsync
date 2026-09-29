"""Tool definitions for the actor. The list is static (never reordered or
templated) so it sits in the cacheable prompt prefix."""

# Shared bookkeeping args attached to every action tool.
_COMMON = {
    "reason": {"type": "string", "description": "Why, in at most 12 words."},
    "note": {
        "type": "string",
        "description": "Optional fact worth remembering for later steps (e.g. a value found on the page).",
    },
    "subgoal_done": {
        "type": "boolean",
        "description": "True if the CURRENT subgoal is already satisfied by the page you see now.",
    },
}


def _tool(name: str, description: str, props: dict | None = None, required: list[str] | None = None) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": {**(props or {}), **_COMMON},
                "required": [*(required or []), "reason"],
            },
        },
    }


TOOLS = [
    _tool("click", "Click an element by its id.", {"target_id": {"type": "integer"}}, ["target_id"]),
    _tool(
        "type_text",
        "Replace the content of an input/textarea by id. Set submit=true to press Enter afterwards (e.g. search boxes).",
        {"target_id": {"type": "integer"}, "text": {"type": "string"}, "submit": {"type": "boolean"}},
        ["target_id", "text"],
    ),
    _tool(
        "scroll",
        "Scroll one viewport. Only visible elements are listed, so scroll to find things off-screen.",
        {"direction": {"type": "string", "enum": ["up", "down"]}},
        ["direction"],
    ),
    _tool(
        "open_url",
        "Navigate the current tab to a URL. Prefer this over clicking through menus when you know the site.",
        {"url": {"type": "string"}},
        ["url"],
    ),
    _tool("go_back", "Go back to the previous page in history."),
    _tool(
        "read_page",
        "Fetch the page's visible text (redacted). Use to read articles, results, prices, or to answer/summarize. "
        "Much cheaper than a screenshot for text.",
    ),
    _tool(
        "request_screenshot",
        "Ask for a screenshot of the viewport with numbered badges matching element ids. Only when the element "
        "list is ambiguous (icon-only controls, canvas, visual layout). At most once per page state.",
    ),
    _tool(
        "request_user_input",
        "Pause and let the human fill a login, signup, OTP, payment, consent or other PII form themselves. "
        "Never invent passwords, OTPs, emails, phone numbers or addresses.",
        {"message": {"type": "string", "description": "Short instruction shown to the user."}},
        ["message"],
    ),
    _tool(
        "task_complete",
        "Finish. Put the answer or a short result summary in `summary`. success=false if the task is impossible.",
        {"summary": {"type": "string"}, "success": {"type": "boolean"}},
        ["summary"],
    ),
]

ACTION_TOOL_NAMES = {t["function"]["name"] for t in TOOLS}
