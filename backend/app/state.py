from typing import TypedDict, Literal, Optional


class ElementRef(TypedDict):
    """One interactive element from the client's sanitized DOM snapshot."""
    data_item: str            # unique id assigned by the extension, e.g. "17"
    element_id: Optional[str] # native HTML id attribute, if the element has one
    tag: str                  # "button", "input", "a", etc.
    role: Optional[str]       # aria role, if any
    value: Optional[str]      # visible text/value, already PII-redacted client-side


class AgentAction(TypedDict):
    """A single action the agent wants the client to execute."""
    type: Literal["CLICK", "TYPE", "SCROLL", "DONE"]
    data_item: Optional[str]   # required for CLICK / TYPE, unused for SCROLL / DONE
    element_id: Optional[str]  # native HTML id of the target element, if known
    text: Optional[str]        # required for TYPE, unused otherwise
    reasoning: Optional[str]   # short justification from the model, useful for debugging/demo


class AgentState(TypedDict):
    # session / task
    session_id: str
    task_goal: str

    # this turn's sanitized input from the extension
    sanitized_dom: list[ElementRef]
    sanitized_screenshot_b64: str

    # accumulated across turns (loaded from store at ingest_context)
    action_history: list[AgentAction]

    # working fields used within a single graph run
    proposed_action: Optional[AgentAction]
    retry_count: int
    is_valid: bool
    is_complete: bool
    error: Optional[str]