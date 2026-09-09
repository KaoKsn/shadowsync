from typing import Optional
from app.state import AgentAction


class SessionData:
    def __init__(self, task_goal: str):
        self.task_goal = task_goal
        self.action_history: list[AgentAction] = []
        self.is_complete: bool = False


# in-memory store keyed by session_id -- swap this dict for RedisSaver later,
# the get/save/reset functions below are the only surface the graph touches
_sessions: dict[str, SessionData] = {}


def get_session(session_id: str, task_goal: str) -> SessionData:
    """Fetch existing session, or start a new one for this session_id."""
    if session_id not in _sessions:
        _sessions[session_id] = SessionData(task_goal=task_goal)
    return _sessions[session_id]


def append_action(session_id: str, action: AgentAction) -> None:
    session = _sessions.get(session_id)
    if session is None:
        raise KeyError(f"Unknown session_id: {session_id}")
    session.action_history.append(action)


def mark_complete(session_id: str) -> None:
    session = _sessions.get(session_id)
    if session is None:
        raise KeyError(f"Unknown session_id: {session_id}")
    session.is_complete = True


def reset_session(session_id: str) -> bool:
    """Removes a session entirely -- used both for explicit mid-task
    cancellation and for automatic cleanup once a task completes.
    Returns True if a session actually existed and was removed.
    """
    return _sessions.pop(session_id, None) is not None