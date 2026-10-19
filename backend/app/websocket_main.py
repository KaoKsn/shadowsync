"""
WebSocket backend for the PrivSight browser agent.

Endpoint: ws://<host>:8001/ws/task  (or ws://<host>:8000/ws/task)

Message protocol (per WEBSOCKET_API.md):
  client -> {type:"start",  session_id, task, snapshot}
  server <- {session_id, status, action, summary}
  client -> {type:"step",   session_id, task, snapshot}
  server <- {session_id, status, action, summary}
  client -> {type:"screenshot", session_id, task, snapshot}
  server <- {session_id, status, action, summary}
  client -> {type:"stop",   session_id}
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from base64 import b64decode
from binascii import Error as BinasciiError

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.graph import graph
from app import store

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="PrivSight WebSocket Agent Backend")


def _save_sanitized_screenshot(session_id: str, screenshot_b64: str) -> None:
    if not screenshot_b64:
        return
    screenshot_dir = Path(__file__).resolve().parents[1] / "artifacts" / "screenshots"
    screenshot_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    screenshot_path = screenshot_dir / f"{session_id}_{timestamp}.png"

    encoded = screenshot_b64.split(",", 1)[1] if "," in screenshot_b64 else screenshot_b64
    try:
        screenshot_path.write_bytes(b64decode(encoded))
    except (BinasciiError, ValueError):
        pass


def _snapshot_to_state(session_id: str, task: str, snapshot: dict) -> dict:
    raw_elements = snapshot.get("elements") or []

    sanitized_dom = []
    for el in raw_elements:
        mark_id = el.get("mark_id")
        if mark_id is None:
            mark_id = el.get("data_hint")
        data_hint = str(mark_id) if mark_id is not None else ""

        val = el.get("value")
        txt = el.get("text")
        if el.get("redacted"):
            val = "[REDACTED]"
            txt = "[REDACTED]"
        elif val is None and txt is not None:
            val = txt

        sanitized_dom.append({
            "data_hint":    data_hint,
            "element_id":   el.get("element_id") or el.get("id") or None,
            "tag":          str(el.get("tag") or "div"),
            "role":         el.get("role") or None,
            "value":        val,
            "aria_label":   el.get("aria_label") or None,
            "placeholder":  el.get("placeholder") or None,
            "name":         el.get("name") or None,
            "type":         el.get("input_type") or el.get("type") or None,
            "href":         el.get("href") or None,
            "disabled":     bool(el.get("disabled", False)),
            "checked":      el.get("checked"),
            "text":         txt,
        })

    screenshot_b64 = snapshot.get("screenshot_b64") or ""
    if screenshot_b64:
        _save_sanitized_screenshot(session_id, screenshot_b64)

    return {
        "session_id":              session_id,
        "task_goal":               task,
        "sanitized_dom":           sanitized_dom,
        "sanitized_screenshot_b64": screenshot_b64,
    }


def _action_to_ws_response(session_id: str, response_payload: dict) -> dict:
    rp = response_payload or {}
    action_type = str(rp.get("type") or "").upper()

    if action_type == "DONE" or rp.get("is_complete"):
        status = "done"
        action = {"type": "task_complete", "summary": rp.get("text") or rp.get("reasoning") or "Task completed."}
        summary = rp.get("text") or rp.get("reasoning") or "Task completed successfully."
    else:
        TYPE_MAP = {
            "CLICK":              "click",
            "TYPE":               "type_text",
            "SCROLL":             "scroll",
            "NEW_TAB":            "new_tab",
            "GO_BACK":            "go_back",
            "GO_FORWARD":         "go_forward",
            "USER":               "user",
            "REQUEST_SCREENSHOT": "request_screenshot",
        }
        wire_type = TYPE_MAP.get(action_type, action_type.lower())

        target_id_raw = rp.get("data_hint") or rp.get("element_id")
        try:
            target_id = int(target_id_raw) if target_id_raw is not None else None
        except (ValueError, TypeError):
            target_id = target_id_raw

        action = {
            "type":      wire_type,
            "target_id": target_id,
            "text":      rp.get("text"),
            "url":       rp.get("url"),
            "direction": rp.get("direction"),
            "summary":   rp.get("reasoning"),
        }
        action = {k: v for k, v in action.items() if v is not None}
        status = "failed" if rp.get("is_failed") else "running"
        summary = rp.get("reasoning") or None

    return {
        "session_id": session_id,
        "status":     status,
        "action":     action,
        "summary":    summary,
    }


async def handle_websocket_task(websocket: WebSocket):
    await websocket.accept()
    logger.info("[WS] Client connected")

    cached_task: str = ""
    session_id: str = ""

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"error": "Invalid JSON"}))
                continue

            msg_type = str(msg.get("type") or "").lower()
            session_id = str(msg.get("session_id") or session_id)

            logger.info("[WS] Received type=%s session_id=%s", msg_type, session_id)

            if msg_type == "stop":
                store.reset_session(session_id)
                logger.info("[WS] Session %s stopped by client", session_id)
                break

            if msg_type not in ("start", "step", "screenshot"):
                await websocket.send_text(json.dumps({"error": f"Unknown message type: {msg_type}"}))
                continue

            snapshot = msg.get("snapshot") or {}

            # Preserve task: prefer incoming if non-empty, otherwise use cached or session task
            incoming_task = str(msg.get("task") or "").strip()
            if incoming_task:
                cached_task = incoming_task
            elif not cached_task and session_id:
                existing = store.get_session(session_id, "")
                if existing and existing.task_goal:
                    cached_task = existing.task_goal

            if not session_id:
                await websocket.send_text(json.dumps({"error": "session_id is required"}))
                continue

            if not cached_task:
                await websocket.send_text(json.dumps({
                    "session_id": session_id,
                    "status": "failed",
                    "action": None,
                    "summary": "task is required in start message"
                }))
                continue

            initial_state = _snapshot_to_state(session_id, cached_task, snapshot)

            logger.info(
                "[WS] Running graph: session=%s task=%r step=%s elements=%d",
                session_id,
                cached_task,
                snapshot.get("step", "?"),
                len(snapshot.get("elements") or []),
            )

            try:
                final_state = graph.invoke(initial_state)
            except Exception as exc:
                logger.exception("[WS] Graph invocation failed for session %s", session_id)
                store.append_request_log({
                    "timestamp":  datetime.now(timezone.utc).isoformat(),
                    "session_id": session_id,
                    "task_goal":  cached_task,
                    "status":     "error",
                    "error":      str(exc),
                })
                await websocket.send_text(json.dumps({
                    "session_id": session_id,
                    "status":     "failed",
                    "action":     None,
                    "summary":    f"Agent error: {exc}",
                }))
                continue

            store.append_request_log({
                "timestamp":    datetime.now(timezone.utc).isoformat(),
                "session_id":   session_id,
                "task_goal":    cached_task,
                "total_tokens": final_state.get("token_usage_total", 0),
                "status":       "success",
            })

            response = _action_to_ws_response(session_id, final_state.get("response_payload") or {})
            logger.info("[WS] Sending response: %s", response)
            await websocket.send_text(json.dumps(response))

    except WebSocketDisconnect:
        logger.info("[WS] Client disconnected (session=%s)", session_id)
    except Exception as exc:
        logger.exception("[WS] Unexpected error in ws_task (session=%s)", session_id)
        try:
            await websocket.send_text(json.dumps({
                "session_id": session_id,
                "status":     "failed",
                "action":     None,
                "summary":    f"Server error: {exc}",
            }))
        except Exception:
            pass
    finally:
        logger.info("[WS] Connection closed (session=%s)", session_id)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.websocket("/ws/task")
async def ws_task(websocket: WebSocket):
    await handle_websocket_task(websocket)
