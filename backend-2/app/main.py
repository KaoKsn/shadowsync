import asyncio
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .config import ALLOWED_ORIGINS
from .graph.build_graph import build_graph
from .schemas import AgentResponse, ClientMessage

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("privsight")

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

agent_graph, checkpointer = build_graph()


def _initial_state(msg: ClientMessage) -> dict:
    return {
        "session_id": msg.session_id,
        "task": msg.task,
        "status": "running",
        "plan": [],
        "plan_idx": 0,
        "start_url": None,
        "memory": [],
        "journal": [],
        "url": "",
        "title": "",
        "elements": [],
        "page_sig": "",
        "screenshot_available": False,
        "last_action": None,
        "recent_fps": [],
        "stuck_level": 0,
        "screenshot_sigs": [],
        "screenshots_used": 0,
        "read_sigs": [],
        "replan_count": 0,
        "total_steps": 0,
        "pending_action": None,
        "summary": None,
        "usage": {},
    }


def _delete_session(session_id: str) -> None:
    try:
        checkpointer.delete_thread(session_id)
        return
    except (NotImplementedError, AttributeError):
        # AttributeError: older langgraph savers (e.g. MemorySaver with the
        # pinned langgraph 0.2.x) have no delete_thread at all.
        pass
    memory_storage = getattr(checkpointer, "storage", None)
    if isinstance(memory_storage, dict):
        memory_storage.pop(session_id, None)
        return
    redis_client = getattr(checkpointer, "_redis", None)
    if redis_client is None:
        return
    # langgraph-checkpoint-redis 0.0.5 has no delete_thread: remove the
    # thread's checkpoint / blob / write keys directly.
    from langgraph.checkpoint.redis.util import to_storage_safe_id

    safe_id = to_storage_safe_id(session_id)
    for prefix in ("checkpoint", "checkpoint_blob", "checkpoint_write"):
        keys = list(redis_client.scan_iter(match=f"{prefix}:{safe_id}:*", count=500))
        if keys:
            redis_client.delete(*keys)


def _run(msg: ClientMessage) -> AgentResponse:
    """One graph invoke per message. Heavy payloads go through configurable
    (not state) so they never hit the Redis checkpoint."""
    snapshot = msg.snapshot.model_dump(exclude={"screenshot_b64"}) if msg.snapshot else None
    configurable = {"thread_id": msg.session_id}

    if msg.type == "start":
        _delete_session(msg.session_id)
        graph_input = {**_initial_state(msg), "snapshot": snapshot, "incoming": "start"}
    else:
        graph_input = {"incoming": msg.type}
        if snapshot:
            graph_input["snapshot"] = snapshot
        if msg.type == "screenshot":
            configurable["screenshot_b64"] = msg.snapshot.screenshot_b64 if msg.snapshot else None
        elif msg.type == "page_text":
            configurable["page_text"] = msg.page_text or ""

    result = agent_graph.invoke(graph_input, config={"configurable": configurable})
    return AgentResponse(
        session_id=msg.session_id,
        status=result.get("status", "failed"),
        action=result.get("pending_action"),
        summary=result.get("summary"),
    )


@app.get("/health")
def health():
    return {"status": "ok", "checkpointer": type(checkpointer).__name__}


def _origin_allowed(origin: str | None) -> bool:
    """Web pages can open WebSockets to localhost, so only the extension (or
    non-browser clients, which send no Origin) may use the agent."""
    if not origin:
        return True
    origin = origin.rstrip("/")
    if ALLOWED_ORIGINS:
        return origin in ALLOWED_ORIGINS
    return origin.startswith("chrome-extension://")


@app.websocket("/ws/task")
async def websocket_task(websocket: WebSocket):
    if not _origin_allowed(websocket.headers.get("origin")):
        log.warning("rejected WebSocket from origin %s", websocket.headers.get("origin"))
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        while True:
            try:
                msg = ClientMessage.model_validate_json(await websocket.receive_text())
            except ValidationError as exc:
                await websocket.send_json({"error": f"invalid message: {exc.errors()[:3]}"})
                continue

            if msg.type == "stop":
                _delete_session(msg.session_id)
                await websocket.send_json({"session_id": msg.session_id, "status": "stopped"})
                break

            if msg.type in ("start", "step", "screenshot") and not msg.snapshot:
                await websocket.send_json({"error": f"snapshot is required for {msg.type}"})
                continue

            try:
                # LLM calls are blocking; keep the event loop free.
                response = await asyncio.to_thread(_run, msg)
                await websocket.send_json(response.model_dump(exclude_none=True))
                if response.status in ("done", "failed"):
                    # Finished: free the checkpoint (MemorySaver never expires it).
                    await asyncio.to_thread(_delete_session, msg.session_id)
            except Exception as exc:
                log.exception("agent turn failed for session %s", msg.session_id)
                await websocket.send_json(
                    {"session_id": msg.session_id, "status": "failed", "summary": f"Backend error: {exc}"}
                )
    except WebSocketDisconnect:
        pass
