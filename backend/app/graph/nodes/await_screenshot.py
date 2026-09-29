def await_screenshot(state: dict) -> dict:
    # The API layer fills state["snapshot"].screenshot_b64 (requested from
    # the extension) before resuming the graph into this node, then routes
    # straight back into act with the image available in context.
    return state