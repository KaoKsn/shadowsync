from app.state import AgentState, AgentAction
from app.config import settings
from langsmith import traceable


def _invalid(state: AgentState, message: str) -> AgentState:
    state["is_valid"] = False
    state["retry_count"] += 1
    state["error"] = message

    if state["retry_count"] >= settings.max_retries:
        # give up automating this step -- hand off to the human instead of
        # looping forever or falsely claiming the task is done
        state["proposed_action"] = AgentAction(
            type="USER",
            data_hint=None,
            element_id=None,
            text=(
                "I'm having trouble completing this step automatically. "
                "Could you please take over and perform it manually?"
            ),
            url=None,
            reasoning=f"Exceeded max retries ({settings.max_retries}): {message}",
        )
        state["is_valid"] = True
        state["is_complete"] = False

    return state



@traceable(name="validate_action")
def validate_action(state: AgentState) -> AgentState:
    """Pure logic, no LLM call. Checks the proposed action against the
    current sanitized_dom and decides whether to accept it, retry, or
    escalate to the human after too many failed attempts.
    """
    action = state.get("proposed_action")

    if action is None:
        return _invalid(state, "No action proposed (model call failed or returned unparseable JSON)")

    action_type = action["type"]

    if action_type == "DONE":
        state["is_valid"] = True
        state["is_complete"] = True
        state["error"] = None
        return state

    if action_type == "USER":
        if not action.get("text"):
            return _invalid(state, "USER action is missing an instruction in 'text'")
        state["is_valid"] = True
        state["is_complete"] = False
        state["error"] = None
        return state

    if action_type in ("SCROLL", "GO_BACK", "GO_FORWARD", "NEW_TAB"):
        # these act on the page/browser itself, not a specific element -- no data_hint needed
        state["is_valid"] = True
        state["is_complete"] = False
        state["error"] = None
        return state

    if action_type in ("CLICK", "TYPE"):
        data_hint = action.get("data_hint")
        if not data_hint:
            return _invalid(state, f"{action_type} action is missing 'data_hint'")

        target = next(
            (el for el in state["sanitized_dom"] if el["data_hint"] == data_hint),
            None,
        )
        if target is None:
            return _invalid(state, f"data_hint '{data_hint}' does not exist in current elements")
        if target.get("disabled"):
            return _invalid(state, f"data_hint '{data_hint}' refers to a disabled element")
        if action_type == "TYPE" and not action.get("text"):
            return _invalid(state, "TYPE action is missing 'text'")

        state["is_valid"] = True
        state["is_complete"] = False
        state["error"] = None
        return state

    return _invalid(state, f"Unknown action type: {action_type}")