"""
Wiring for the agent's StateGraph.

IMPORTANT -- pause/resume semantics: `dispatch_action` and
`await_screenshot` are meant to pause execution until the extension sends
back a new snapshot (or a screenshot). The exact mechanism for this
(interrupt_before / interrupt_after / a manual END + re-invoke keyed by
thread_id) differs between LangGraph versions. This file uses the
"END + re-invoke with the same thread_id" pattern, which is the simplest
to reason about, but confirm it against the docs for whichever
langgraph / langgraph-checkpoint-redis version you actually pin in
requirements.txt before relying on it -- checkpoint/resume APIs have
shifted across releases.
"""

from contextlib import ExitStack

from langgraph.graph import END, StateGraph
from langgraph.checkpoint.redis import RedisSaver

from ..config import REDIS_URL
from ..state import AgentState
from .nodes import act, await_screenshot, dispatch_action, finish, ingest_snapshot, replan, verify

# RedisSaver.from_conn_string() is a context manager, not a plain
# constructor -- it needs to stay entered for as long as the app runs.
# This ExitStack holds it open for the process lifetime; if you want a
# clean shutdown later, wire _redis_stack.close() into FastAPI's
# lifespan shutdown handler instead of relying on process exit.
_redis_stack = ExitStack()


def route_after_ingest(state: AgentState) -> str:
    if state.get("resume_reason") == "screenshot_result":
        return "act"          # skip verify entirely -- this isn't an action outcome
    if state.get("pending_action"):
        return "verify"
    return "act"


def route_after_act(state: AgentState) -> str:
    action_type = state["pending_action"]["type"]
    if action_type == "request_screenshot":
        return "await_screenshot"
    if action_type in ("summarize_page", "task_complete"):
        return "finish"
    return "dispatch_action"


def route_after_verify(state: AgentState) -> str:
    if state["status"] in ("done", "failed"):
        return "finish"
    if state["pending_action"] is None:
        return "act"
    return "replan"


def build_graph():
    graph = StateGraph(AgentState)

    graph.add_node("ingest_snapshot", ingest_snapshot)
    graph.add_node("act", act)
    graph.add_node("await_screenshot", await_screenshot)
    graph.add_node("dispatch_action", dispatch_action)
    graph.add_node("verify", verify)
    graph.add_node("replan", replan)
    graph.add_node("finish", finish)

    graph.set_entry_point("ingest_snapshot")

    graph.add_conditional_edges(
        "ingest_snapshot",
        route_after_ingest,
        {"verify": "verify", "act": "act"},
    )
    graph.add_conditional_edges(
        "act",
        route_after_act,
        {
            "await_screenshot": "await_screenshot",
            "dispatch_action": "dispatch_action",
            "finish": "finish",
        },
    )
    graph.add_edge("await_screenshot", END)
    graph.add_edge("dispatch_action", END)
    graph.add_conditional_edges(
        "verify",
        route_after_verify,
        {"finish": "finish", "act": "act", "replan": "replan"},
    )
    graph.add_edge("replan", "act")
    graph.add_edge("finish", END)

    ttl_config = {
        "default_ttl": 5,       # minutes -- tune to whatever your demo run length needs
        "refresh_on_read": True, # resets expiry when a checkpoint is read (keeps active sessions alive)
    }

    checkpointer = _redis_stack.enter_context(RedisSaver.from_conn_string(REDIS_URL, ttl=ttl_config))
    checkpointer.setup()  # required on first use -- creates Redis indices
    compiled = graph.compile(checkpointer=checkpointer)
    return compiled, checkpointer
