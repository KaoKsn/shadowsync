def ingest_snapshot(state: dict) -> dict:
    """Pure normalization -- no LLM call. The API layer has already set
    state['snapshot'] to the latest ClientSnapshot before invoking the
    graph; this node exists as a stable entry point for routing."""
    return state