import json

from ...config import MAX_JOURNAL_ENTRIES, MAX_TOTAL_STEPS
from ...schemas import AgentAction
from ...services.openai_client import call_act_model
from ...tools import TOOLS, render_snapshot_for_prompt
from ._shared import _parse_tool_call, _prepare_image_url_for_llm, _visible_ids


def act(state: dict) -> dict:
    snapshot_text = render_snapshot_for_prompt(state["snapshot"])
    journal_text = "\n".join(state["action_journal"][-MAX_JOURNAL_ENTRIES:])
    subgoal = (
        state["plan"][state["current_step"]] if state["plan"] else state["task"]
    )

    state["total_steps"] = state.get("total_steps", 0) + 1
    if state["total_steps"] > MAX_TOTAL_STEPS:
        state["status"] = "failed"
        state["last_result_summary"] = "Exceeded max step budget without completing."
        state["pending_action"] = {"type": "task_complete", "summary": state["last_result_summary"]}
        return state

    user_content = [
        {
            "type": "text",
            "text": (
                f"Overall task: {state['task']}\n"
                f"Current subgoal: {subgoal}\n"
                f"Recent actions:\n{journal_text or '(none yet)'}\n\n"
                f"Visible elements:\n{snapshot_text}\n\n"
                "Pick exactly one tool call for the next step."
            ),
        }
    ]
    # If a screenshot was requested last turn and the extension sent one
    # back, attach it now -- and consume it so it isn't re-sent on
    # subsequent turns (stale-image cost otherwise creeps back in).
    if state["snapshot"].screenshot_b64:
        compact_data_url = _prepare_image_url_for_llm(state["snapshot"].screenshot_b64)
        user_content.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": compact_data_url,
                    "detail": "low",
                },
            }
        )
        state["snapshot"].screenshot_b64 = None

    messages = [
        {
            "role": "system",
            "content": (
                "You control a browser via discrete tool calls. You only "
                "see elements currently visible in the viewport -- if "
                "something you need is probably off-screen, scroll first "
                "rather than guessing it exists. Only request a screenshot "
                "when the visible elements are genuinely ambiguous (e.g. "
                "icon-only controls) -- it costs an extra round trip. When "
                "a screenshot is returned, it comes with the same numbered "
                "DOM mapping shown in the prompt, so use those numbers to "
                "match what you see in the image to the actionable elements. "
                "If you hit a login, signup, verification, account creation, "
                "consent, or any other PII-sensitive form that requires the "
                "human user to enter private data, do not guess or type any "
                "sensitive value yourself. Instead call request_user_input "
                "with a short message telling the frontend to pause, ask the "
                "user to fill the required fields locally, then continue once "
                "the form is submitted and a fresh snapshot is sent back."
            ),
        },
        {"role": "user", "content": user_content},
    ]

    message = call_act_model(messages, TOOLS)
    tool_calls = message.get("tool_calls", None) if isinstance(message, dict) else message.tool_calls
    tool_call = tool_calls[0]
    parsed = _parse_tool_call(tool_call)
    name = parsed["name"]
    args = json.loads(parsed["arguments"] if isinstance(parsed["arguments"], str) else json.dumps(parsed["arguments"]))

    # Guard against a hallucinated target_id -- give the model exactly one
    # corrective turn rather than letting dispatch_action choke on it.
    if args.get("target_id") is not None and args["target_id"] not in _visible_ids(
        state["snapshot"]
    ):
        tool_call_payload = (
            tool_call if isinstance(tool_call, dict) else {"id": parsed["id"], "type": "function", "function": {"name": parsed["name"], "arguments": parsed["arguments"]}}
        )
        messages.append({"role": "assistant", "tool_calls": [tool_call_payload]})
        messages.append(
            {
                "role": "tool",
                "tool_call_id": parsed["id"],
                "content": (
                    f"Error: id {args['target_id']} is not among the "
                    "currently visible elements. Pick a valid id, or use "
                    "scroll/request_screenshot instead."
                ),
            }
        )
        message = call_act_model(messages, TOOLS)
        tool_calls = message.get("tool_calls", None) if isinstance(message, dict) else message.tool_calls
        tool_call = tool_calls[0]
        parsed = _parse_tool_call(tool_call)
        name = parsed["name"]
        args = json.loads(parsed["arguments"] if isinstance(parsed["arguments"], str) else json.dumps(parsed["arguments"]))

    action = AgentAction(type=name, **args)

    # First action of a fresh task with no plan yet: seed a trivial
    # single-item plan so current_step/verify logic has something to
    # work against, without spending a separate LLM call to get it.
    if not state["plan"]:
        state["plan"] = [subgoal]

    state["pending_action"] = action.model_dump()
    return state