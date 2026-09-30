from typing import Literal, Optional, TypedDict


class PlanStep(TypedDict):
    goal: str
    done_when: str


class AgentState(TypedDict, total=False):
    """Everything here is checkpointed to Redis on every super-step, so it is
    kept deliberately small. Screenshots and page text never live here --
    they travel through config["configurable"] for a single invoke."""

    session_id: str
    task: str
    status: Literal["running", "done", "failed"]

    # Latest client input, set by the API layer before each invoke.
    snapshot: Optional[dict]
    incoming: Literal["start", "step", "screenshot", "page_text"]

    plan: list[PlanStep]
    plan_idx: int
    start_url: Optional[str]
    memory: list[str]
    journal: list[str]

    url: str
    title: str
    elements: list[dict]      # compact: {id, line, labeled}
    page_sig: str
    screenshot_available: bool

    last_action: Optional[dict]      # {type, submit, desc, url, page_sig, hashes} awaiting an outcome
    recent_fps: list[str]            # url|action, for loop detection
    stuck_level: int                 # consecutive actions with no visible effect

    screenshot_sigs: list[str]
    screenshots_used: int
    read_sigs: list[str]             # page_sigs already sent through read_page
    replan_count: int
    total_steps: int

    pending_action: Optional[dict]
    summary: Optional[str]
    usage: dict
