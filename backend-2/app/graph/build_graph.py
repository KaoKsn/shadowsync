"""
Wiring for the agent's StateGraph.

One graph invoke per extension message (thread_id = session_id). The graph
always ends after producing a single action; the next message re-enters at
`observe` with the checkpointed state. Screenshots and page text are passed
via config["configurable"] so they're never written to the checkpoint.

    observe ─┬─ planner ──┐
             ├─ reader ───┤
             ├─ replanner ┼─► actor ─► emit ─► END
             ├─ request_vision ───────► emit
             ├─ actor
             └─ finish ─► END          (planner/reader/replanner/actor may
                                         also go straight to emit or finish)
"""

import logging
from contextlib import ExitStack

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from ..config import REDIS_URL, SESSION_TTL_MINUTES, USE_REDIS
from ..state import AgentState
from .nodes import actor, emit, finish, observe, planner, reader, replanner, request_vision
from .router import route_after_observe, route_after_plan, route_to_action

log = logging.getLogger("privsight")

# RedisSaver.from_conn_string() is a context manager; keep it entered for the
# process lifetime.
_redis_stack = ExitStack()

_TO_ACTION = {"emit": "emit", "actor": "actor", "finish": "finish"}


def _make_checkpointer():
    if USE_REDIS:
        try:
            from langgraph.checkpoint.redis import RedisSaver

            saver = _redis_stack.enter_context(
                RedisSaver.from_conn_string(
                    REDIS_URL, ttl={"default_ttl": SESSION_TTL_MINUTES, "refresh_on_read": True}
                )
            )
            saver.setup()
            log.info("Using Redis checkpointer at %s", REDIS_URL)
            return saver
        except Exception as exc:  # Redis down / missing RedisJSON+RediSearch modules
            log.warning("Redis unavailable (%s); falling back to in-memory checkpointer", exc)
    return MemorySaver()


def build_graph(checkpointer=None):
    graph = StateGraph(AgentState)
    graph.add_node("observe", observe)
    graph.add_node("planner", planner)
    graph.add_node("reader", reader)
    graph.add_node("replanner", replanner)
    graph.add_node("request_vision", request_vision)
    graph.add_node("actor", actor)
    graph.add_node("emit", emit)
    graph.add_node("finish", finish)

    graph.set_entry_point("observe")
    graph.add_conditional_edges(
        "observe",
        route_after_observe,
        {n: n for n in ("finish", "reader", "planner", "replanner", "request_vision", "actor")},
    )
    for node in ("reader", "actor"):
        graph.add_conditional_edges(node, route_to_action, _TO_ACTION)
    for node in ("planner", "replanner"):
        graph.add_conditional_edges(node, route_after_plan, {**_TO_ACTION, "request_vision": "request_vision"})
    graph.add_edge("request_vision", "emit")
    graph.add_edge("emit", END)
    graph.add_edge("finish", END)

    checkpointer = checkpointer or _make_checkpointer()
    return graph.compile(checkpointer=checkpointer), checkpointer
