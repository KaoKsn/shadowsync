from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
from pathlib import Path
from base64 import b64decode
from binascii import Error as BinasciiError
import logging
from datetime import datetime, timezone

from langsmith import traceable

from app.graph import graph
from app import store

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

app = FastAPI(title="Browser Agent Backend")
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def _save_sanitized_screenshot(session_id: str, screenshot_b64: str) -> Path:
    screenshot_dir = Path(__file__).resolve().parents[1] / "artifacts" / "screenshots"
    screenshot_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    screenshot_path = screenshot_dir / f"{session_id}_{timestamp}.png"

    encoded = screenshot_b64.split(",", 1)[1] if "," in screenshot_b64 else screenshot_b64
    try:
        screenshot_path.write_bytes(b64decode(encoded))
    except (BinasciiError, ValueError) as exc:
        raise ValueError("Invalid sanitized_screenshot_b64 payload") from exc

    return screenshot_path


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
    url: Optional[str] = None
    reasoning: Optional[str] = None
    is_complete: bool


@app.get("/health")
def health():
    return {"status": "ok"}


@traceable(name="take_turn")
@app.post("/turn", response_model=TurnResponse)
def take_turn(req: TurnRequest):
    """One observe -> act cycle. The extension calls this each time it has
    a new sanitized DOM + screenshot to hand off, and executes whatever
    action comes back, then calls again with the resulting page state.
    """
    token_usage_total = 0
    try:
        screenshot_path = _save_sanitized_screenshot(req.session_id, req.sanitized_screenshot_b64)
        initial_state = {
            "session_id": req.session_id,
            "task_goal": req.task_goal,
            "sanitized_dom": [el.model_dump() for el in req.sanitized_dom],
            "sanitized_screenshot_b64": req.sanitized_screenshot_b64,
        }

        logger.info(
            "take_turn session_id=%s task_goal=%s sanitized_dom_len=%s screenshot_path=%s",
            req.session_id,
            req.task_goal,
            len(req.sanitized_dom),
            screenshot_path,
        )

        final_state = graph.invoke(initial_state)
        token_usage_total = final_state.get("token_usage_total", 0)
        logger.info("agent_response=%s", final_state.get("response_payload"))

        store.append_request_log(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "session_id": req.session_id,
                "task_goal": req.task_goal,
                "total_tokens": token_usage_total,
                "status": "success",
            }
        )

        return final_state["response_payload"]
    except ValueError as exc:
        store.append_request_log(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "session_id": req.session_id,
                "task_goal": req.task_goal,
                "total_tokens": token_usage_total,
                "status": "error",
                "error": str(exc),
            }
        )
        logger.exception("Invalid turn payload for session_id=%s", req.session_id)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        store.append_request_log(
            {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "session_id": req.session_id,
                "task_goal": req.task_goal,
                "total_tokens": token_usage_total,
                "status": "error",
                "error": "Failed to process turn",
            }
        )
        logger.exception("Failed to process turn for session_id=%s", req.session_id)
        raise HTTPException(status_code=500, detail="Failed to process turn") from exc


@app.delete("/session/{session_id}")
def end_session(session_id: str):
    """Cancels a session before it reaches DONE -- e.g. the user closes
    the tab, changes their mind, or aborts the task partway through.
    """
    try:
        existed = store.reset_session(session_id)
        if not existed:
            raise HTTPException(status_code=404, detail="Session not found")
        return {"session_id": session_id, "status": "ended"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to end session_id=%s", session_id)
        raise HTTPException(status_code=500, detail="Failed to end session") from exc