"""The one LLM call per step: pick the next browser action via a tool call."""

from langchain_core.runnables import RunnableConfig

from ...config import IMAGE_DETAIL
from ...llm import add_usage, call_tools
from ...prompts import ACTOR_SYSTEM, render_actor_context
from ...schemas import AgentAction
from ...tools import ACTION_TOOL_NAMES, TOOLS
from ...vision import compress_image
from ._common import advance_plan, append_memory, describe_action, screenshot_allowed

_ACTION_FIELDS = set(AgentAction.model_fields) - {"type"}


def _to_action(call: dict) -> dict:
    args = {k: v for k, v in call["arguments"].items() if k in _ACTION_FIELDS and v is not None}
    try:
        return AgentAction(type=call["name"], **args).model_dump(exclude_none=True)
    except Exception:
        return AgentAction(type=call["name"], reason=args.get("reason")).model_dump(exclude_none=True)


def _validate(call: dict | None, state: dict, image_attached: bool) -> str | None:
    """Returns an error message for the model, or None if the call is usable."""
    if call is None:
        return "You must respond with exactly one tool call."
    name, args = call["name"], call["arguments"]
    if name not in ACTION_TOOL_NAMES:
        return f"Unknown tool {name!r}."

    if name in ("click", "type_text"):
        ids = {el["id"] for el in state.get("elements", [])}
        if args.get("target_id") not in ids:
            return f"Error: id {args.get('target_id')} is not in the current element list. Pick a listed id, or scroll/read_page."
    if name == "type_text" and not isinstance(args.get("text"), str):
        return "type_text needs `text`."
    if name == "open_url" and not str(args.get("url") or "").strip():
        return "open_url needs a `url`."
    if name == "request_screenshot" and (image_attached or not screenshot_allowed(state)):
        return "No screenshot is available for this page state. Decide from the element list, or use scroll/read_page/go_back."

    if name not in ("task_complete", "read_page", "request_screenshot"):
        fingerprint = f"{state.get('page_sig')}|{describe_action(_to_action(call), state)}"
        if state.get("recent_fps", []).count(fingerprint) >= 2:
            return "You already did exactly this twice on this same page without progress. Choose a different action."
    return None


def _fallback(state: dict) -> dict:
    if screenshot_allowed(state):
        return {"type": "request_screenshot", "reason": "Element list is ambiguous; checking the screen"}
    return {"type": "scroll", "direction": "down", "reason": "Looking for more options"}


def actor(state: dict, config: RunnableConfig) -> dict:
    configurable = (config or {}).get("configurable", {})
    screenshot = configurable.get("screenshot_b64") if state.get("incoming") == "screenshot" else None

    stuck = state.get("stuck_level", 0)
    feedback = f"the last {stuck} action(s) had no visible effect. Do something different." if stuck else None
    text = render_actor_context(state, feedback)
    content: list[dict] = [{"type": "text", "text": text}]

    image_url = compress_image(screenshot)
    if image_url:
        content[0]["text"] += "\n\nScreenshot attached: yellow badges show element ids."
        content.append({"type": "image_url", "image_url": {"url": image_url, "detail": IMAGE_DETAIL}})

    messages = [{"role": "system", "content": ACTOR_SYSTEM}, {"role": "user", "content": content}]
    meta = {"session": state["session_id"], "image": bool(image_url), "step": state.get("total_steps", 0)}

    call, usage = call_tools(messages, TOOLS, node="actor", meta=meta)
    totals = add_usage(state.get("usage"), usage)

    error = _validate(call, state, bool(image_url))
    if error:
        # One corrective turn, then fall back deterministically.
        if call is None:
            messages.append({"role": "user", "content": error})
        else:
            messages.append({
                "role": "assistant",
                "tool_calls": [{"id": call["id"], "type": "function",
                                "function": {"name": call["name"], "arguments": call["raw_arguments"]}}],
            })
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": error})
        call, usage = call_tools(messages, TOOLS, node="actor_retry", meta=meta)
        totals = add_usage(totals, usage)
        if _validate(call, state, bool(image_url)):
            call = None

    update: dict = {"usage": totals}
    if call is None:
        update["pending_action"] = _fallback(state)
        return update

    args = call["arguments"]
    if args.get("subgoal_done"):
        update["plan_idx"] = advance_plan(state)
    if args.get("note"):
        update["memory"] = append_memory(state, str(args["note"]))

    action = _to_action(call)
    if action["type"] == "task_complete":
        success = action.get("success") is not False
        update.update(status="done" if success else "failed", summary=action.get("summary") or "Task finished.")
    update["pending_action"] = action
    return update
