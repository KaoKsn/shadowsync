import logging

from ...config import MAX_TOTAL_STEPS

log = logging.getLogger("privsight")


def finish(state: dict) -> dict:
    status = state.get("status", "running")
    summary = state.get("summary")
    if status == "running":
        status = "failed"
        summary = f"Stopped after {MAX_TOTAL_STEPS} steps without finishing the task."

    # The extension treats any task_complete action as success, so failures
    # carry no action -- only status + summary.
    pending = None
    if status == "done":
        pending = state.get("pending_action") or {"type": "task_complete", "summary": summary, "success": True}

    log.info("session %s finished: %s | usage=%s", state.get("session_id"), status, state.get("usage"))
    return {"status": status, "summary": summary, "pending_action": pending}
