from ...config import MAX_REPLANS
from ...llm import add_usage, call_json
from ...prompts import PLAN_SCHEMA, REPLANNER_SYSTEM, host_of, render_elements, render_plan, short_url
from ._common import append_journal, clean_plan


def replanner(state: dict) -> dict:
    """Only reached after the observer detects a real stall (and a screenshot
    was already tried when available)."""
    if state.get("replan_count", 0) >= MAX_REPLANS:
        return {
            "status": "failed",
            "summary": "I got stuck on this page and couldn't find a way forward. Last steps: "
            + "; ".join(state.get("journal", [])[-3:]),
        }

    memory = "\n".join(f"- {m}" for m in state.get("memory", [])) or "(none)"
    messages = [
        {"role": "system", "content": REPLANNER_SYSTEM},
        {
            "role": "user",
            "content": (
                f"TASK: {state['task']}\n\n"
                f"OLD PLAN:\n{render_plan(state.get('plan', []), state.get('plan_idx', 0))}\n\n"
                f"HISTORY:\n" + "\n".join(f"- {j}" for j in state.get("journal", [])[-8:]) + "\n\n"
                f"NOTES:\n{memory}\n\n"
                f"PAGE: {state.get('title') or '(untitled)'} | {short_url(state.get('url'))}\n"
                f"ELEMENTS:\n{render_elements(state.get('elements', []))}"
            ),
        },
    ]
    data, usage = call_json("planner", messages, PLAN_SCHEMA, name="replanner", meta={"session": state["session_id"]})
    update = {
        "usage": add_usage(state.get("usage"), usage),
        "replan_count": state.get("replan_count", 0) + 1,
        "stuck_level": 0,
        "recent_fps": [],
    }

    plan = clean_plan(data.get("plan"))
    if plan and plan[0]["goal"].upper().startswith("IMPOSSIBLE"):
        update.update(status="failed", summary=plan[0]["goal"].split(":", 1)[-1].strip() or "The task isn't possible here.")
        return update
    if plan:
        update.update(plan=plan, plan_idx=0)
    update["journal"] = append_journal(state, "replanned: " + "; ".join(p["goal"] for p in plan or state.get("plan", [])))

    start_url = (data.get("start_url") or "").strip()
    if start_url and host_of(start_url) != host_of(state.get("url")):
        update["pending_action"] = {"type": "open_url", "url": start_url, "reason": "Trying a different route"}
    return update
