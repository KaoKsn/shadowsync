from langgraph.graph import StateGraph, END

from app.state import AgentState
from app.nodes.ingest_context import ingest_context
from app.nodes.reason_plan import reason_plan
from app.nodes.validate_action import validate_action
from app.nodes.persist_session import persist_session
from app.nodes.respond import respond


def _route_after_validation(state: AgentState) -> str:
    """validate_action already forces is_valid=True once retries are
    exhausted (falling back to a USER handoff action), so this only
    ever loops back to reason_plan while a genuine retry is left.
    """
    if state["is_valid"]:
        return "persist_session"
    return "reason_plan"


def build_graph():
    builder = StateGraph(AgentState)

    builder.add_node("ingest_context", ingest_context)
    builder.add_node("reason_plan", reason_plan)
    builder.add_node("validate_action", validate_action)
    builder.add_node("persist_session", persist_session)
    builder.add_node("respond", respond)

    builder.set_entry_point("ingest_context")

    builder.add_edge("ingest_context", "reason_plan")
    builder.add_edge("reason_plan", "validate_action")
    builder.add_conditional_edges(
        "validate_action",
        _route_after_validation,
        {
            "persist_session": "persist_session",
            "reason_plan": "reason_plan",
        },
    )
    builder.add_edge("persist_session", "respond")
    builder.add_edge("respond", END)

    return builder.compile()


# single compiled graph instance, imported by main.py
graph = build_graph()