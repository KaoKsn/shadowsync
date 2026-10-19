from app.state import AgentState
from app.llm import generate_action
from langsmith import traceable


@traceable(name="reason_plan")
def reason_plan(state: AgentState) -> AgentState:
    """Calls the configured VLM (Ollama or OpenAI, per settings.model_provider)
    to decide the next action given the task goal, history, and current
    sanitized elements. Pure decision -- no validation happens here.
    """
    try:
        action, token_usage = generate_action(state)
        state["proposed_action"] = action
        state["token_usage_total"] = state.get("token_usage_total", 0) + (token_usage or 0)
        state["error"] = None
    except Exception as exc:
        # model call failed or returned unparseable JSON -- let validate_action
        # treat this as invalid so the retry loop kicks in
        state["proposed_action"] = None
        state["error"] = f"reason_plan failed: {exc}"

    return state