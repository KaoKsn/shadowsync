from ...config import MAX_JOURNAL_STORED, MAX_MEMORY_NOTES, MAX_SCREENSHOTS
from ...prompts import _clip, short_url


def element_body(state: dict, target_id) -> str:
    for el in state.get("elements", []):
        if el["id"] == target_id:
            return el["body"]
    return f"[{target_id}]"


def describe_action(action: dict, state: dict) -> str:
    """One-line, id-free description -- ids are re-numbered every capture,
    so journal lines and loop fingerprints use element bodies instead."""
    kind = action["type"]
    if kind == "click":
        return f"click {element_body(state, action.get('target_id'))}"
    if kind == "type_text":
        suffix = " +Enter" if action.get("submit") else ""
        return f'type "{_clip(action.get("text"), 30)}" into {element_body(state, action.get("target_id"))}{suffix}'
    if kind == "scroll":
        return f"scroll {action.get('direction') or 'down'}"
    if kind == "open_url":
        return f"open {short_url(action.get('url'))}"
    if kind == "go_back":
        return "go back"
    if kind == "request_user_input":
        return "asked user to complete the form"
    return kind


def append_journal(state: dict, line: str) -> list[str]:
    return [*state.get("journal", []), line][-MAX_JOURNAL_STORED:]


def append_memory(state: dict, note: str | None) -> list[str]:
    memory = list(state.get("memory", []))
    note = _clip(note, 200)
    if note and note not in memory:
        memory.append(note)
    return memory[-MAX_MEMORY_NOTES:]


def advance_plan(state: dict) -> int:
    return min(state.get("plan_idx", 0) + 1, len(state.get("plan", [])))


def screenshot_allowed(state: dict) -> bool:
    return (
        bool(state.get("screenshot_available"))
        and state.get("screenshots_used", 0) < MAX_SCREENSHOTS
        and state.get("page_sig") not in state.get("screenshot_sigs", [])
    )


def clean_plan(raw) -> list[dict]:
    plan = []
    for step in raw or []:
        if isinstance(step, dict) and str(step.get("goal", "")).strip():
            plan.append({"goal": _clip(step["goal"], 120), "done_when": _clip(step.get("done_when") or "done", 120)})
    return plan[:5]
