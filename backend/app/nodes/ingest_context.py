from app.state import AgentState
from app import store
from langsmith import traceable


@traceable(name="ingest_context")
def ingest_context(state: AgentState) -> AgentState:
    """Entry node. The caller (FastAPI endpoint) has already populated
    session_id, task_goal, sanitized_dom, sanitized_screenshot_b64 on `state`.
    This node loads/creates the session and fills in everything the rest of
    the graph needs, resetting per-run working fields.
    """
    session = store.get_session(
        session_id=state["session_id"],
        task_goal=state["task_goal"],
    )

    state["action_history"] = session.action_history
    state["proposed_action"] = None
    state["token_usage_total"] = 0
    state["retry_count"] = 0
    state["is_valid"] = False
    state["is_complete"] = session.is_complete
    state["error"] = None

    return state