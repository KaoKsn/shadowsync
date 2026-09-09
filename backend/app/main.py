from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.graph import graph
from app import store

app = FastAPI(title="Browser Agent Backend")


class ElementRefRequest(BaseModel):
    data_hint: str
    element_id: Optional[str] = None

    tag: str
    role: Optional[str] = None

    value: Optional[str] = None
    aria_label: Optional[str] = None
    placeholder: Optional[str] = None

    name: Optional[str] = None
    type: Optional[str] = None

    href: Optional[str] = None

    disabled: bool = False
    checked: Optional[bool] = None


class TurnRequest(BaseModel):
    session_id: str
    task_goal: str
    sanitized_dom: list[ElementRefRequest]
    sanitized_screenshot_b64: str


class TurnResponse(BaseModel):
    session_id: str
    type: str
    data_hint: Optional[str] = None
    element_id: Optional[str] = None
    text: Optional[str] = None
    reasoning: Optional[str] = None
    is_complete: bool


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/turn", response_model=TurnResponse)
def take_turn(req: TurnRequest):
    """One observe -> act cycle. The extension calls this each time it has
    a new sanitized DOM + screenshot to hand off, and executes whatever
    action comes back, then calls again with the resulting page state.
    """
    initial_state = {
        "session_id": req.session_id,
        "task_goal": req.task_goal,
        "sanitized_dom": [el.model_dump() for el in req.sanitized_dom],
        "sanitized_screenshot_b64": req.sanitized_screenshot_b64,
    }

    final_state = graph.invoke(initial_state)

    return final_state["response_payload"]


@app.delete("/session/{session_id}")
def end_session(session_id: str):
    """Cancels a session before it reaches DONE -- e.g. the user closes
    the tab, changes their mind, or aborts the task partway through.
    """
    existed = store.reset_session(session_id)
    if not existed:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session_id, "status": "ended"}