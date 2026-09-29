from ...llm import add_usage, call_json
from ...prompts import PLAN_SCHEMA, PLANNER_SYSTEM, host_of, short_url
from ._common import clean_plan


def planner(state: dict) -> dict:
    """Runs once per task, text only."""
    messages = [
        {"role": "system", "content": PLANNER_SYSTEM},
        {
            "role": "user",
            "content": (
                f"TASK: {state['task']}\n"
                f"CURRENT PAGE: {state.get('title') or '(untitled)'} | {short_url(state.get('url'))}"
            ),
        },
    ]
    data, usage = call_json("planner", messages, PLAN_SCHEMA, name="planner", meta={"session": state["session_id"]})
    plan = clean_plan(data.get("plan")) or [{"goal": state["task"], "done_when": "the task is complete"}]
    update = {"plan": plan, "plan_idx": 0, "usage": add_usage(state.get("usage"), usage)}

    # Skip an actor round trip when the planner already knows where to go.
    start_url = (data.get("start_url") or "").strip()
    if start_url and host_of(start_url) != host_of(state.get("url")):
        update["pending_action"] = {"type": "open_url", "url": start_url, "reason": "Opening the site needed for this task"}
    return update
