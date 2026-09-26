import json

from ..config import MAX_JOURNAL_ENTRIES, MAX_RETRIES, MAX_TOTAL_STEPS
from ..schemas import AgentAction
from ..services.openai_client import call_act_model, call_replan_model
from ..tools import TOOLS, render_snapshot_for_prompt


def ingest_snapshot(state: dict) -> dict:
    """Pure normalization -- no LLM call. The API layer has already set
    state['snapshot'] to the latest ClientSnapshot before invoking the
    graph; this node exists as a stable entry point for routing."""
    return state


def _visible_ids(snapshot) -> set[int]:
    return {el.id for el in snapshot.elements}


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
        user_content.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{state['snapshot'].screenshot_b64}"
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
                "icon-only controls) -- it costs an extra round trip."
            ),
        },
        {"role": "user", "content": user_content},
    ]

    message = call_act_model(messages, TOOLS)
    tool_call = message.tool_calls[0]
    name = tool_call.function.name
    args = json.loads(tool_call.function.arguments)

    # Guard against a hallucinated target_id -- give the model exactly one
    # corrective turn rather than letting dispatch_action choke on it.
    if args.get("target_id") is not None and args["target_id"] not in _visible_ids(
        state["snapshot"]
    ):
        messages.append({"role": "assistant", "tool_calls": [tool_call]})
        messages.append(
            {
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": (
                    f"Error: id {args['target_id']} is not among the "
                    "currently visible elements. Pick a valid id, or use "
                    "scroll/request_screenshot instead."
                ),
            }
        )
        message = call_act_model(messages, TOOLS)
        tool_call = message.tool_calls[0]
        name = tool_call.function.name
        args = json.loads(tool_call.function.arguments)

    action = AgentAction(type=name, **args)

    # First action of a fresh task with no plan yet: seed a trivial
    # single-item plan so current_step/verify logic has something to
    # work against, without spending a separate LLM call to get it.
    if not state["plan"]:
        state["plan"] = [subgoal]

    state["pending_action"] = action.model_dump()
    return state


def await_screenshot(state: dict) -> dict:
    # The API layer fills state["snapshot"].screenshot_b64 (requested from
    # the extension) before resuming the graph into this node, then routes
    # straight back into act with the image available in context.
    return state


def dispatch_action(state: dict) -> dict:
    action = state["pending_action"]
    state["action_journal"].append(
        f"step {state['snapshot'].step}: {action['type']} -> "
        f"{ {k: v for k, v in action.items() if v is not None} }"
    )
    # Actual delivery to the extension happens in the API layer. This node
    # marks the journal and then the graph pauses (see build_graph.py) --
    # verify against your installed LangGraph version's interrupt/resume
    # docs for the exact pause mechanism, it's changed across versions.
    return state


def verify(state: dict) -> dict:
    action = state["pending_action"]
    changed = state["snapshot"].changed_since_last_step

    if action["type"] in ("summarize_page", "task_complete"):
        state["status"] = "done"
        state["last_result_summary"] = action.get("summary")
        return state

    expected_id = action.get("target_id")
    outcome_matched = expected_id is not None and expected_id in changed

    if outcome_matched:
        state["current_step"] = min(
            state["current_step"] + 1, max(len(state["plan"]) - 1, 0)
        )
        state["pending_action"] = None
        state["retry_count"] = 0
        return state

    if action["type"] == "scroll":
        # scroll has no target_id to diff against -- treat as always
        # "succeeded" and let the next act call judge the new viewport
        state["pending_action"] = None
        return state

    state["retry_count"] += 1
    if state["retry_count"] > MAX_RETRIES:
        state["status"] = "failed"
    return state


def replan(state: dict) -> dict:
    schema = {
        "type": "object",
        "properties": {
            "plan": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["plan"],
        "additionalProperties": False,
    }
    messages = [
        {
            "role": "system",
            "content": (
                "The previous action did not produce the expected result. "
                "Revise the remaining plan given the current state."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Task: {state['task']}\n"
                f"Old plan: {state['plan']}\n"
                f"Failed at step: {state['current_step']}\n"
                f"Recent actions:\n"
                f"{chr(10).join(state['action_journal'][-MAX_JOURNAL_ENTRIES:])}"
            ),
        },
    ]
    data = call_replan_model(messages, schema)
    state["plan"] = data["plan"]
    state["current_step"] = 0
    state["retry_count"] = 0
    state["pending_action"] = None
    return state


def finish(state: dict) -> dict:
    return state
