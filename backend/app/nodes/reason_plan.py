from app.state import AgentState
from app.llm import generate_action


def reason_plan(state: AgentState) -> AgentState:
    """Calls the configured VLM (Ollama or OpenAI, per settings.model_provider)
    to decide the next action given the task goal, history, and current
    sanitized elements. Pure decision -- no validation happens here.
    """
    try:
        action = generate_action(state)
        state["proposed_action"] = action
        state["error"] = None
    except Exception as exc:
        # model call failed or returned unparseable JSON -- let validate_action
        # treat this as invalid so the retry loop kicks in
        state["proposed_action"] = None
        state["error"] = f"reason_plan failed: {exc}"

    return state