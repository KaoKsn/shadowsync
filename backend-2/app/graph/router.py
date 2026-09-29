from ..config import MAX_TOTAL_STEPS
from .nodes._common import screenshot_allowed


def vision_gate(state: dict) -> bool:
    """Ask for a screenshot only when the element list is likely insufficient."""
    if state.get("incoming") == "screenshot" or not screenshot_allowed(state):
        return False
    if state.get("stuck_level", 0) == 2:
        return True
    elements = state.get("elements", [])
    if len(elements) < 3:
        return True
    unlabeled = sum(1 for el in elements if not el["labeled"])
    return len(elements) >= 5 and unlabeled / len(elements) > 0.4


def route_after_observe(state: dict) -> str:
    if state.get("status", "running") != "running" or state.get("total_steps", 0) >= MAX_TOTAL_STEPS:
        return "finish"
    if state.get("incoming") == "page_text":
        return "reader"
    if not state.get("plan"):
        return "planner"
    if state.get("stuck_level", 0) >= 3:
        return "replanner"
    if vision_gate(state):
        return "request_vision"
    return "actor"


def route_to_action(state: dict) -> str:
    """Shared by reader / actor."""
    if state.get("status", "running") != "running":
        return "finish"
    if state.get("pending_action"):
        return "emit"
    return "actor"


def route_after_plan(state: dict) -> str:
    """planner / replanner: same as above, but the page hasn't been judged by
    the vision gate yet on this turn."""
    route = route_to_action(state)
    if route == "actor" and vision_gate(state):
        return "request_vision"
    return route
