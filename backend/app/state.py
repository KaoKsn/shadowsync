from typing import TypedDict, Literal, Optional


class ElementRef(TypedDict):
    data_hint: str                 # Unique PrivSight reference, e.g. "17"
    element_id: Optional[str]      # Native HTML id, if present
    tag: str                        # HTML tag, e.g. "button", "input", "a"
    role: Optional[str]             # ARIA role, if present
    value: Optional[str]            # Visible text/value, PII-redacted
    aria_label: Optional[str]       # Accessible name/label
    placeholder: Optional[str]      # Input placeholder text
    name: Optional[str]             # HTML name attribute
    type: Optional[str]             # Input type, e.g. "email", "checkbox"
    href: Optional[str]             # Link destination, if applicable
    disabled: bool                  # Whether the element is disabled
    checked: Optional[bool]         # Checked state for checkbox/radio

class AgentAction(TypedDict):
    """A single action the agent wants the client to execute."""
    type: Literal["CLICK", "TYPE", "SCROLL", "DONE", "USER"]
    data_hint: Optional[str]    # matches ElementRef.data_hint of the target element
    element_id: Optional[str]   # native HTML id of the target element, if known
    text: Optional[str]         # TYPE: text to type. USER: instruction for the human. unused otherwise
    reasoning: Optional[str]    # short justification from the model, useful for debugging/demo


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
    response_payload: Optional[dict]