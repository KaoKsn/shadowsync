def dispatch_action(state: dict) -> dict:
    action = state["pending_action"]
    state["action_journal"].append(
        f"step {state['snapshot'].step}: {action['type']} -> "
        f"{ {k: v for k, v in action.items() if v is not None} }"
    )
    # Actual delivery to the extension happens in the API layer. This node
    # marks the journal and then the graph pauses (see build_graph.py) --
    # verify against your installed LangGraph version's interrupt/resume
    # docs for the exact pause mechanism, it's changed across versions.
    return state