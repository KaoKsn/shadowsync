from app.state import AgentState


def respond(state: AgentState) -> AgentState:
    """No LLM call, no side effects. Shapes the final payload that the
    FastAPI endpoint will send back to the extension. The action itself
    was already validated and persisted by earlier nodes.
    """
    action = state["proposed_action"]

    state["response_payload"] = {
        "session_id": state["session_id"],
        "type": action["type"],
        "data_hint": action.get("data_hint"),
        "element_id": action.get("element_id"),
        "text": action.get("text"),
        "reasoning": action.get("reasoning"),
        "is_complete": state["is_complete"],
    }

    return state