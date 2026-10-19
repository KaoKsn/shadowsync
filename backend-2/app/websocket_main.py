import json
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .graph.nodes import (
    act,
    await_screenshot,
    dispatch_action,
    finish,
    ingest_snapshot,
    replan,
    verify,
)
from .schemas import AgentResponse, ClientSnapshot, TaskRequest
from .state import AgentState

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_SESSION_GRAPHS: dict[str, Any] = {}
_SESSION_STATES: dict[str, dict] = {}


def _build_initial_state(session_id: str, task: str, snapshot: ClientSnapshot) -> dict:
    return {
        "session_id": session_id,
        "task": task,
        "plan": [],
        "current_step": 0,
        "total_steps": 0,
        "snapshot": snapshot,
        "action_journal": [],
        "pending_action": None,
        "retry_count": 0,
        "status": "running",
        "last_result_summary": None,
        "resume_reason": None,
    }


def route_after_ingest(state: AgentState) -> str:
    if state.get("resume_reason") == "screenshot_result":
        return "act"
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


def build_memory_graph():
    from langgraph.graph import END, StateGraph

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
        {"await_screenshot": "await_screenshot", "dispatch_action": "dispatch_action", "finish": "finish"},
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
    return graph.compile()


def _to_response(result: dict) -> AgentResponse:
    return AgentResponse(
        session_id=result["session_id"],
        status=result["status"],
        action=result.get("pending_action"),
        summary=result.get("last_result_summary"),
    )


def _get_graph(session_id: str):
    if session_id not in _SESSION_GRAPHS:
        _SESSION_GRAPHS[session_id] = build_memory_graph()
    return _SESSION_GRAPHS[session_id]


def _run_task(session_id: str, task: str, snapshot: ClientSnapshot, resume_reason: str | None = None):
    graph = _get_graph(session_id)

    if session_id not in _SESSION_STATES:
        state = _build_initial_state(session_id, task, snapshot)
    else:
        state = dict(_SESSION_STATES[session_id])
        state["task"] = task
        state["snapshot"] = snapshot

    if resume_reason is not None:
        state["resume_reason"] = resume_reason
        state["snapshot"] = snapshot
    else:
        state = _build_initial_state(session_id, task, snapshot)

    result = graph.invoke(state)
    _SESSION_STATES[session_id] = dict(result)
    return _to_response(result)


@app.get("/health")
def health():
    return {"status": "ok", "mode": "websocket-memory"}


@app.websocket("/ws/task")
async def websocket_task(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            raw = await websocket.receive_text()
            payload = json.loads(raw)
            message_type = payload.get("type", "start")
            session_id = payload["session_id"]
            task = payload.get("task", "")
            snapshot = payload.get("snapshot")

            if message_type == "start":
                if not snapshot:
                    await websocket.send_json({"error": "snapshot is required for start"})
                    continue
                req = TaskRequest(session_id=session_id, task=task, snapshot=snapshot)
                result = _run_task(session_id, req.task, req.snapshot)
                await websocket.send_json(result.model_dump())

            elif message_type in ("step", "screenshot"):
                if not snapshot:
                    await websocket.send_json({"error": "snapshot is required for step"})
                    continue
                resume_reason = "action_result" if message_type == "step" else "screenshot_result"
                req = TaskRequest(session_id=session_id, task=task, snapshot=snapshot)
                result = _run_task(session_id, req.task, req.snapshot, resume_reason=resume_reason)
                await websocket.send_json(result.model_dump())

            elif message_type == "stop":
                _SESSION_GRAPHS.pop(session_id, None)
                _SESSION_STATES.pop(session_id, None)
                await websocket.send_json({"session_id": session_id, "status": "stopped"})
                break

            else:
                await websocket.send_json({"error": f"unknown message type: {message_type}"})

    except WebSocketDisconnect:
        pass
    except Exception as exc:  # pragma: no cover
        await websocket.send_json({"error": str(exc)})
