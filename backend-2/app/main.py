from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .graph.build_graph import build_graph
from .schemas import AgentResponse, TaskRequest

app = FastAPI()
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

agent_graph, checkpointer = build_graph()


def _config(session_id: str) -> dict:
    return {"configurable": {"thread_id": session_id}}


def _to_response(result: dict) -> AgentResponse:
    return AgentResponse(
        session_id=result["session_id"],
        status=result["status"],
        action=result.get("pending_action"),
        summary=result.get("last_result_summary"),
    )


@app.post("/task/start", response_model=AgentResponse)
def start_task(req: TaskRequest):
    initial_state = {
        "session_id": req.session_id,
        "task": req.task,
        "plan": [],
        "current_step": 0,
        "total_steps": 0,
        "snapshot": req.snapshot,
        "action_journal": [],
        "pending_action": None,
        "retry_count": 0,
        "status": "running",
        "last_result_summary": None,
        "resume_reason": None,
    }
    result = agent_graph.invoke(initial_state, config=_config(req.session_id))
    return _to_response(result)


@app.post("/task/step", response_model=AgentResponse)
def step_task(req: TaskRequest):
    """Extension reports the result of an action it just executed."""
    update = {"snapshot": req.snapshot, "resume_reason": "action_result"}
    result = agent_graph.invoke(update, config=_config(req.session_id))
    return _to_response(result)


@app.post("/task/screenshot", response_model=AgentResponse)
def screenshot_task(req: TaskRequest):
    """Extension delivers a screenshot that was explicitly requested.
    Separate from /task/step on purpose -- this skips verify entirely
    and goes straight back to act with the image attached."""
    update = {"snapshot": req.snapshot, "resume_reason": "screenshot_result"}
    result = agent_graph.invoke(update, config=_config(req.session_id))
    return _to_response(result)


@app.post("/task/stop")
def stop_task(session_id: str):
    """User cancelled mid-task -- wipe the checkpoint so nothing lingers
    and a stray late request can't accidentally resume a dead session."""
    try:
        checkpointer.delete_thread(session_id)
    except AttributeError:
        raise HTTPException(
            status_code=500,
            detail=(
                "delete_thread isn't available on this checkpointer -- "
                "check your langgraph-checkpoint-redis version, or rely "
                "on TTL expiry as a fallback for now."
            ),
        )
    return {"session_id": session_id, "status": "stopped"}


@app.get("/health")
def health():
    return {"status": "ok"}