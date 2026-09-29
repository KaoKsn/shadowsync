from ...config import MAX_JOURNAL_ENTRIES
from ...services.openai_client import call_replan_model


def replan(state: dict) -> dict:
    schema = {
        "type": "object",
        "properties": {
            "plan": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["plan"],
        "additionalProperties": False,
    }
    messages = [
        {
            "role": "system",
            "content": (
                "The previous action did not produce the expected result. "
                "Revise the remaining plan given the current state."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Task: {state['task']}\n"
                f"Old plan: {state['plan']}\n"
                f"Failed at step: {state['current_step']}\n"
                f"Recent actions:\n"
                f"{chr(10).join(state['action_journal'][-MAX_JOURNAL_ENTRIES:])}"
            ),
        },
    ]
    data = call_replan_model(messages, schema)
    state["plan"] = data["plan"]
    state["current_step"] = 0
    state["retry_count"] = 0
    state["pending_action"] = None
    return state