from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict


class ElementSnapshot(BaseModel):
    model_config = ConfigDict(extra="ignore")

    mark_id: int
    tag: str
    role: Optional[str] = None
    input_type: Optional[str] = None
    text: Optional[str] = None
    value: Optional[str] = None
    name: Optional[str] = None
    placeholder: Optional[str] = None
    aria_label: Optional[str] = None
    disabled: bool = False
    redacted: bool = False
    redaction_reason: Optional[str] = None


class ClientSnapshot(BaseModel):
    model_config = ConfigDict(extra="ignore")

    session_id: str
    step: int = 0
    url: Optional[str] = None
    title: Optional[str] = None
    elements: List[ElementSnapshot] = []
    # Kept for backward compatibility; the backend computes its own diff.
    changed_since_last_step: List[int] = []
    screenshot_available: bool = False
    # Only populated in reply to a request_screenshot action.
    screenshot_b64: Optional[str] = None


MessageType = Literal["start", "step", "screenshot", "page_text", "stop"]


class ClientMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: MessageType = "start"
    session_id: str
    task: str = ""
    snapshot: Optional[ClientSnapshot] = None
    # Only populated in reply to a read_page action.
    page_text: Optional[str] = None


ActionType = Literal[
    "click",
    "type_text",
    "scroll",
    "open_url",
    "go_back",
    "read_page",
    "request_screenshot",
    "request_user_input",
    "task_complete",
]


class AgentAction(BaseModel):
    type: ActionType
    target_id: Optional[int] = None
    text: Optional[str] = None
    submit: Optional[bool] = None
    direction: Optional[Literal["up", "down"]] = None
    url: Optional[str] = None
    message: Optional[str] = None
    summary: Optional[str] = None
    success: Optional[bool] = None
    reason: Optional[str] = None


class AgentResponse(BaseModel):
    session_id: str
    status: Literal["running", "done", "failed"]
    action: Optional[AgentAction] = None
    summary: Optional[str] = None
