"""Cheap text-only extraction over page text, so long page content never
enters the actor's context -- only the distilled notes do."""

from langchain_core.runnables import RunnableConfig

from ...config import MAX_PAGE_TEXT_CHARS
from ...llm import add_usage, call_json
from ...prompts import READER_SCHEMA, READER_SYSTEM, _clip, short_url
from ._common import advance_plan, append_journal, append_memory


def reader(state: dict, config: RunnableConfig) -> dict:
    text = ((config or {}).get("configurable", {}).get("page_text") or "").strip()
    if not text:
        return {"journal": append_journal(state, "read page → no readable text")}

    plan, idx = state.get("plan", []), state.get("plan_idx", 0)
    subgoal = plan[idx]["goal"] if idx < len(plan) else state["task"]
    messages = [
        {"role": "system", "content": READER_SYSTEM},
        {
            "role": "user",
            "content": (
                f"TASK: {state['task']}\nCURRENT SUBGOAL: {subgoal}\n"
                f"PAGE: {short_url(state.get('url'))}\n\nTEXT:\n{text[:MAX_PAGE_TEXT_CHARS]}"
            ),
        },
    ]
    data, usage = call_json("reader", messages, READER_SCHEMA, name="reader", meta={"session": state["session_id"]})
    notes = (data.get("notes") or "").strip()

    update = {
        "usage": add_usage(state.get("usage"), usage),
        "memory": append_memory(state, notes),
        "journal": append_journal(state, f"read page → {_clip(notes, 80) or 'nothing relevant'}"),
    }
    if data.get("subgoal_done"):
        update["plan_idx"] = advance_plan(state)

    answer = (data.get("answer") or "").strip()
    if answer:
        update.update(status="done", summary=answer, pending_action={"type": "task_complete", "summary": answer, "success": True})
    return update
