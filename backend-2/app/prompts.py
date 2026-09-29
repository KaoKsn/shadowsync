"""Static system prompts and compact renderers.

Prompt layout is cache-friendly: the system prompt (and tool list) never
change, all per-turn data goes in the final user message."""

import hashlib
from urllib.parse import urlsplit

from .config import MAX_ELEMENTS, MAX_JOURNAL_IN_PROMPT, MAX_LABEL_CHARS

ACTOR_SYSTEM = """You are PrivSight, a privacy-preserving browser agent. Each turn you get the task, a plan, notes, recent actions with their observed outcomes, and the interactive elements visible in the current viewport as lines `id tag "label"`. Respond with exactly one tool call.

Rules:
- Work on the current subgoal (marked →). Set subgoal_done=true when the page shows it is satisfied.
- Only use ids from the current element list; ids change every turn.
- If the site you need is not open, use open_url instead of hunting for links.
- To search, type_text into the search box with submit=true.
- Only the viewport is listed: scroll to reveal more; use read_page to read text content (articles, results, prices, answers, summaries).
- If the last outcome was "no visible change", do not repeat the same action; try another element, scroll, read_page, or go_back.
- request_screenshot only when the element list is genuinely insufficient (icon-only controls, canvas, visual layout). Never twice for the same page.
- Values shown as [redacted] are private. Never type passwords, OTPs, card numbers, emails, phone numbers or addresses yourself: call request_user_input so the human fills them in.
- Put any fact you will need later (numbers, names, answers) in `note`.
- Call task_complete as soon as the task is done, with the answer/result in summary. If it is impossible, task_complete with success=false and the reason."""

PLANNER_SYSTEM = """You plan tasks for a browser agent that acts one step at a time (click, type, scroll, open_url, go_back, read_page).
Return 1-5 short subgoals, each with a concrete observable `done_when`. Keep them coarse: one subgoal per page/milestone, not per click.
Set start_url to a full URL only if the task clearly needs a different site than the current page (e.g. "search amazon for..." while on google). Otherwise null.
Never plan to enter passwords or personal data; plan a subgoal "user signs in" instead."""

REPLANNER_SYSTEM = """A browser agent is stuck: its recent actions produced no progress. Given the task, old plan, history and current page, return a revised plan for the REMAINING work (1-5 subgoals) that tries a different approach (another element, search, direct URL via start_url, go back, or reading the page). If the task is truly impossible, return a single subgoal whose goal starts with "IMPOSSIBLE:" followed by the reason."""

READER_SYSTEM = """You read the visible text of a web page for a browser agent. Extract only what matters for the task and current subgoal.
- notes: at most 80 words of key facts (numbers, names, dates, links' text). No filler.
- subgoal_done: true if this text satisfies the current subgoal.
- answer: if the text fully answers the WHOLE task (e.g. a question or a summary request), the final answer for the user (concise, max 150 words); otherwise null."""

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "plan": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"goal": {"type": "string"}, "done_when": {"type": "string"}},
                "required": ["goal", "done_when"],
                "additionalProperties": False,
            },
        },
        "start_url": {"type": ["string", "null"]},
    },
    "required": ["plan", "start_url"],
    "additionalProperties": False,
}

READER_SCHEMA = {
    "type": "object",
    "properties": {
        "notes": {"type": "string"},
        "subgoal_done": {"type": "boolean"},
        "answer": {"type": ["string", "null"]},
    },
    "required": ["notes", "subgoal_done", "answer"],
    "additionalProperties": False,
}

_IMPLICIT_ROLES = {
    "a": "link", "button": "button", "input": "textbox", "textarea": "textbox",
    "select": "listbox", "img": "img", "option": "option",
}


def _clip(text: str | None, limit: int = MAX_LABEL_CHARS) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def compact_elements(raw_elements: list[dict]) -> list[dict]:
    """Turn extension elements into compact prompt lines.

    Returns [{id, body, labeled}] where `body` is the line without the id --
    ids are re-numbered by the extension each capture, so page signatures
    and loop detection work on bodies."""
    out = []
    for el in raw_elements[: MAX_ELEMENTS * 2]:
        tag = (el.get("tag") or "div").lower()
        input_type = el.get("input_type")
        head = f"{tag}[{input_type}]" if tag == "input" and input_type and input_type != "text" else tag
        role = el.get("role")
        if role and role != _IMPLICIT_ROLES.get(tag) and role not in (input_type, "textbox"):
            head += f" role={role}"

        label = _clip(el.get("text") or el.get("aria_label"))
        parts = [head]
        if el.get("redacted"):
            parts.append(f"[redacted:{el.get('redaction_reason') or 'pii'}]")
        elif label:
            parts.append(f'"{label}"')
        placeholder = _clip(el.get("placeholder"), 40)
        if placeholder and placeholder != label:
            parts.append(f'ph="{placeholder}"')
        if not label and not placeholder and el.get("name"):
            parts.append(f"name={_clip(el['name'], 30)}")
        if el.get("disabled"):
            parts.append("disabled")

        labeled = bool(label or placeholder or el.get("name") or el.get("redacted"))
        out.append({"id": int(el["mark_id"]), "body": " ".join(parts), "labeled": labeled})
    return out


def render_elements(elements: list[dict]) -> str:
    """Labeled elements one per line; unlabeled ones collapsed per tag so
    they cost a few tokens but their ids stay reachable (e.g. via screenshot)."""
    lines, unlabeled = [], {}
    for el in elements:
        if el["labeled"]:
            if len(lines) < MAX_ELEMENTS:
                lines.append(f"{el['id']} {el['body']}")
        else:
            unlabeled.setdefault(el["body"], []).append(str(el["id"]))
    for body, ids in unlabeled.items():
        lines.append(f"{body} (no label): {','.join(ids[:15])}{'…' if len(ids) > 15 else ''}")
    return "\n".join(lines) if lines else "(no interactive elements visible)"


def page_signature(url: str, elements: list[dict]) -> str:
    base = strip_fragment(url) + "\n" + "\n".join(sorted(el["body"] for el in elements))
    return hashlib.sha1(base.encode("utf-8")).hexdigest()[:12]


def strip_fragment(url: str | None) -> str:
    return (url or "").split("#", 1)[0]


def short_url(url: str | None) -> str:
    if not url:
        return "(unknown)"
    parts = urlsplit(url)
    return _clip(f"{parts.netloc}{parts.path}" + (f"?{parts.query}" if parts.query else ""), 90)


def host_of(url: str | None) -> str:
    host = urlsplit(url or "").netloc.lower()
    return host[4:] if host.startswith("www.") else host


def render_plan(plan: list[dict], plan_idx: int) -> str:
    lines = []
    for i, step in enumerate(plan):
        if i < plan_idx:
            lines.append(f"✓ {i + 1}. {step['goal']}")
        elif i == plan_idx:
            lines.append(f"→ {i + 1}. {step['goal']} (done when: {step['done_when']})")
        else:
            lines.append(f"  {i + 1}. {step['goal']}")
    return "\n".join(lines) or "(no plan)"


def render_actor_context(state: dict, feedback: str | None = None) -> str:
    journal = state.get("journal", [])[-MAX_JOURNAL_IN_PROMPT:]
    memory = state.get("memory", [])
    sections = [
        f"TASK: {state['task']}",
        f"PLAN:\n{render_plan(state.get('plan', []), state.get('plan_idx', 0))}",
    ]
    if memory:
        sections.append("NOTES:\n" + "\n".join(f"- {m}" for m in memory))
    sections.append("RECENT:\n" + ("\n".join(f"- {j}" for j in journal) if journal else "(none yet)"))
    if feedback:
        sections.append(f"LAST RESULT: {feedback}")
    sections.append(f"PAGE: {_clip(state.get('title'), 80) or '(untitled)'} | {short_url(state.get('url'))}")
    sections.append(f"ELEMENTS:\n{render_elements(state.get('elements', []))}")
    return "\n\n".join(sections)
