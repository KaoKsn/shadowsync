from ...config import MAX_RETRIES


def verify(state: dict) -> dict:
    action = state["pending_action"]
    changed = state["snapshot"].changed_since_last_step

    if action["type"] in ("summarize_page", "task_complete"):
        state["status"] = "done"
        state["last_result_summary"] = action.get("summary")
        return state

    expected_id = action.get("target_id")
    outcome_matched = expected_id is not None and expected_id in changed

    if outcome_matched:
        state["current_step"] = min(
            state["current_step"] + 1, max(len(state["plan"]) - 1, 0)
        )
        state["pending_action"] = None
        state["retry_count"] = 0
        return state

    if action["type"] == "scroll":
        # scroll has no target_id to diff against -- treat as always
        # "succeeded" and let the next act call judge the new viewport
        state["pending_action"] = None
        return state

    state["retry_count"] += 1
    if state["retry_count"] > MAX_RETRIES:
        state["status"] = "failed"
    return state