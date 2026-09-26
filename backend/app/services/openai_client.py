import json
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock

from openai import OpenAI

from ..config import OPENAI_API_KEY, OPENAI_MODEL, OPENAI_REPLAN_MODEL

client = OpenAI(api_key=OPENAI_API_KEY)
LOGS_PATH = Path(__file__).resolve().parents[2] / "logs.json"
_LOG_LOCK = Lock()


def _usage_to_dict(usage) -> dict:
    if usage is None:
        return {}
    return {
        "prompt_tokens": getattr(usage, "prompt_tokens", None),
        "completion_tokens": getattr(usage, "completion_tokens", None),
        "total_tokens": getattr(usage, "total_tokens", None),
    }


def _append_log_entry(entry: dict) -> None:
    with _LOG_LOCK:
        if LOGS_PATH.exists():
            try:
                existing = json.loads(LOGS_PATH.read_text(encoding="utf-8"))
                if not isinstance(existing, list):
                    existing = []
            except json.JSONDecodeError:
                existing = []
        else:
            existing = []

        existing.append(entry)
        tmp_path = LOGS_PATH.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
        tmp_path.replace(LOGS_PATH)


def _log_token_usage(*, kind: str, model: str, usage, metadata: dict | None = None) -> None:
    _append_log_entry(
        {
            "timestamp": datetime.now(UTC).isoformat(),
            "kind": kind,
            "model": model,
            "usage": _usage_to_dict(usage),
            "metadata": metadata or {},
        }
    )


def call_act_model(messages: list[dict], tools: list[dict], *, metadata: dict | None = None):
    """One tool call, forced -- act must always pick an action."""
    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=messages,
        tools=tools,
        tool_choice="required",
    )
    _log_token_usage(kind="act", model=OPENAI_MODEL, usage=getattr(response, "usage", None), metadata=metadata)
    return response.choices[0].message


def call_replan_model(messages: list[dict], response_schema: dict, *, metadata: dict | None = None) -> dict:
    """Structured Outputs, strict schema -- no defensive parsing needed."""
    response = client.chat.completions.create(
        model=OPENAI_REPLAN_MODEL,
        messages=messages,
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "replan_output",
                "schema": response_schema,
                "strict": True,
            },
        },
    )
    _log_token_usage(
        kind="replan",
        model=OPENAI_REPLAN_MODEL,
        usage=getattr(response, "usage", None),
        metadata=metadata,
    )
    return json.loads(response.choices[0].message.content)
