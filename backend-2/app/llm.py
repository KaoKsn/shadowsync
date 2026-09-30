"""Single OpenAI-compatible client for OpenAI and Ollama, plus lightweight
token-usage logging (append-only JSONL, one line per call)."""

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import Any, Literal

from openai import OpenAI

from .config import (
    ACTOR_MAX_TOKENS,
    ACTOR_MODEL,
    LLM_BASE_URL,
    LLM_PROVIDER,
    LLM_TIMEOUT_SECONDS,
    OPENAI_API_KEY,
    PLANNER_MAX_TOKENS,
    PLANNER_MODEL,
    READER_MAX_TOKENS,
    READER_MODEL,
)

Role = Literal["actor", "planner", "reader"]

_MODELS = {"actor": ACTOR_MODEL, "planner": PLANNER_MODEL, "reader": READER_MODEL}
_MAX_TOKENS = {"actor": ACTOR_MAX_TOKENS, "planner": PLANNER_MAX_TOKENS, "reader": READER_MAX_TOKENS}

log = logging.getLogger("privsight")

client = OpenAI(
    api_key=OPENAI_API_KEY or "ollama",
    base_url=LLM_BASE_URL,
    timeout=LLM_TIMEOUT_SECONDS,
    max_retries=1,
)

LOG_PATH = Path(__file__).resolve().parents[1] / "logs" / "usage.jsonl"
LOG_PATH.parent.mkdir(exist_ok=True, parents=True)
_LOG_LOCK = Lock()


def _usage(response) -> dict:
    usage = getattr(response, "usage", None)
    if usage is None:
        return {"prompt": 0, "completion": 0, "cached": 0}
    details = getattr(usage, "prompt_tokens_details", None)
    return {
        "prompt": getattr(usage, "prompt_tokens", 0) or 0,
        "completion": getattr(usage, "completion_tokens", 0) or 0,
        "cached": (getattr(details, "cached_tokens", 0) or 0) if details else 0,
    }


def _warn_if_truncated(response, node: str) -> None:
    """A reply cut at max_tokens loses its tool arguments / JSON entirely."""
    if getattr(response.choices[0], "finish_reason", None) == "length":
        log.warning("%s output hit max_tokens and was truncated; raise the *_MAX_TOKENS setting", node)


def parse_json_object(content: str) -> dict:
    """Parse model JSON; tolerate prose/code fences and never raise."""
    try:
        data = json.loads(content or "{}")
    except json.JSONDecodeError:
        # Local models occasionally wrap JSON in prose/code fences.
        start, end = content.find("{"), content.rfind("}")
        try:
            data = json.loads(content[start : end + 1]) if start != -1 and end > start else {}
        except json.JSONDecodeError:
            data = {}
    return data if isinstance(data, dict) else {}


def log_usage(*, node: str, model: str, usage: dict, meta: dict | None = None) -> None:
    entry = {"ts": datetime.now(UTC).isoformat(), "node": node, "model": model, **usage, **(meta or {})}
    with _LOG_LOCK, LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")


def add_usage(totals: dict | None, usage: dict) -> dict:
    totals = dict(totals or {})
    for key in ("prompt", "completion", "cached"):
        totals[key] = totals.get(key, 0) + usage.get(key, 0)
    totals["calls"] = totals.get("calls", 0) + 1
    return totals


def parse_tool_call(tool_call: Any) -> dict:
    """Normalise an SDK object or a raw dict into {id, name, arguments(dict), raw_arguments}."""
    fn = tool_call.get("function", {}) if isinstance(tool_call, dict) else tool_call.function
    name = fn.get("name") if isinstance(fn, dict) else fn.name
    raw = fn.get("arguments", "{}") if isinstance(fn, dict) else fn.arguments
    if isinstance(raw, dict):
        args, raw = raw, json.dumps(raw)
    else:
        try:
            args = json.loads(raw or "{}")
        except json.JSONDecodeError:
            args = {}
    call_id = tool_call.get("id") if isinstance(tool_call, dict) else tool_call.id
    return {"id": call_id or "call_0", "name": name, "arguments": args, "raw_arguments": raw}


def call_tools(messages: list[dict], tools: list[dict], *, node: str, meta: dict | None = None) -> tuple[dict | None, dict]:
    """Forced single tool call. Returns (parsed_tool_call | None, usage)."""
    extra = {"parallel_tool_calls": False} if LLM_PROVIDER == "openai" else {}
    response = client.chat.completions.create(
        model=_MODELS["actor"],
        messages=messages,
        tools=tools,
        tool_choice="required",
        max_tokens=_MAX_TOKENS["actor"],
        temperature=0,
        **extra,
    )
    usage = _usage(response)
    log_usage(node=node, model=_MODELS["actor"], usage=usage, meta=meta)
    _warn_if_truncated(response, node)
    tool_calls = response.choices[0].message.tool_calls or []
    return (parse_tool_call(tool_calls[0]) if tool_calls else None), usage


def call_json(role: Role, messages: list[dict], schema: dict, *, name: str, meta: dict | None = None) -> tuple[dict, dict]:
    """Structured output against a strict JSON schema. Returns (data, usage)."""
    response = client.chat.completions.create(
        model=_MODELS[role],
        messages=messages,
        response_format={
            "type": "json_schema",
            "json_schema": {"name": name, "schema": schema, "strict": True},
        },
        max_tokens=_MAX_TOKENS[role],
        temperature=0,
    )
    usage = _usage(response)
    log_usage(node=name, model=_MODELS[role], usage=usage, meta=meta)
    _warn_if_truncated(response, name)
    return parse_json_object(response.choices[0].message.content or "{}"), usage
