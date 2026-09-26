from typing import List, Literal, Optional

from pydantic import BaseModel


class ElementSnapshot(BaseModel):
    """One DOM element. The extension only sends elements currently
    visible in the viewport -- nothing off-screen is included, by design
    (keeps token usage down and matches what a human would actually see)."""

    id: int
    tag: str
    role: Optional[str] = None
    input_type: Optional[str] = None
    text: Optional[str] = None
    value: Optional[str] = None
    redacted: bool = False
    redaction_reason: Optional[str] = None


class ClientSnapshot(BaseModel):
    session_id: str
    step: int
    elements: List[ElementSnapshot]
    changed_since_last_step: List[int] = []
    screenshot_available: bool = False
    # only populated when the backend explicitly requested it via the
    # request_screenshot tool call
    screenshot_b64: Optional[str] = None


class TaskRequest(BaseModel):
    session_id: str
    task: str
    snapshot: ClientSnapshot


class AgentAction(BaseModel):
    type: Literal[
        "click",
        "type_text",
        "scroll",
        "request_screenshot",
        "summarize_page",
        "task_complete",
    ]
    target_id: Optional[int] = None
    text: Optional[str] = None
    direction: Optional[Literal["up", "down"]] = None
    summary: Optional[str] = None


class AgentResponse(BaseModel):
    session_id: str
    status: Literal["running", "done", "failed"]
    action: Optional[AgentAction] = None
    summary: Optional[str] = None
