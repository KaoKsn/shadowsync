from typing import Literal, Optional, TypedDict

from .schemas import ClientSnapshot

class AgentState(TypedDict):
    session_id: str
    task: str
    plan: list[str]
    current_step: int
    total_steps: int
    snapshot: Optional[ClientSnapshot]
    action_journal: list[str]
    pending_action: Optional[dict]
    retry_count: int
    status: Literal["running", "done", "failed"]
    last_result_summary: Optional[str]
    resume_reason: Optional[str]   # "action_result" | "screenshot_result" | None