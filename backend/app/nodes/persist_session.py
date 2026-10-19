from app.state import AgentState
from app import store
from langsmith import traceable


@traceable(name="persist_session")
def persist_session(state: AgentState) -> AgentState:
    """No LLM call. Appends the validated action to the session's history
    in the store so the next turn's ingest_context sees it. If the task
    is done, the session is deleted entirely rather than kept around --
    a completed task has nothing left to resume.
    """
    action = state["proposed_action"]

    if state["is_complete"]:
        store.reset_session(state["session_id"])
    else:
        store.append_action(state["session_id"], action)
        state["action_history"].append(action)

    return state