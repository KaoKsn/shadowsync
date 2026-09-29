from ._common import describe_action


def request_vision(state: dict) -> dict:
    """Vision gate fired in the router: ask for a screenshot without spending
    an actor call on deciding to."""
    return {"pending_action": {"type": "request_screenshot", "reason": "Page is hard to read from elements; checking the screen"}}


def emit(state: dict) -> dict:
    """Book-keeping for the action about to be sent; the graph then ends and
    resumes at `observe` when the extension reports back."""
    action = state["pending_action"]
    update: dict = {"total_steps": state.get("total_steps", 0) + 1}

    if action["type"] == "request_screenshot":
        update["screenshot_sigs"] = [*state.get("screenshot_sigs", []), state.get("page_sig")][-20:]
        update["screenshots_used"] = state.get("screenshots_used", 0) + 1
    elif action["type"] != "read_page":
        desc = describe_action(action, state)
        update["last_action"] = {
            "type": action["type"],
            "submit": bool(action.get("submit")),
            "desc": desc,
            "url": state.get("url"),
            "page_sig": state.get("page_sig"),
        }
        update["recent_fps"] = [*state.get("recent_fps", []), f"{state.get('page_sig')}|{desc}"][-10:]
    return update
