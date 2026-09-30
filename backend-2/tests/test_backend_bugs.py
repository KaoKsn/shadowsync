"""Robustness fixes: truncated LLM output, session deletion, WebSocket origin."""

import logging
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import llm, main


def _response(content=None, finish_reason="stop"):
    message = SimpleNamespace(content=content, tool_calls=None)
    choice = SimpleNamespace(message=message, finish_reason=finish_reason)
    return SimpleNamespace(choices=[choice], usage=None)


@pytest.fixture
def fake_llm(monkeypatch, tmp_path):
    monkeypatch.setattr(llm, "LOG_PATH", tmp_path / "usage.jsonl")
    replies = []
    create = lambda **_: replies.pop(0)  # noqa: E731
    monkeypatch.setattr(llm.client.chat.completions, "create", create)
    return replies


@pytest.mark.parametrize("content,expected", [
    ('{"notes": "Salary is 12 LPA", "answer": "The sal', {}),       # cut at max_tokens
    ('Sure! {"notes": "a"} and also {"broken": ', {"notes": "a"}),  # recovers the complete object
    ('Here: {"notes": "a", } trailing }', {}),                      # braces found, still invalid JSON
    ("not json at all", {}),
    ("[1, 2, 3]", {}),                                               # valid JSON, wrong shape
])
def test_call_json_never_raises_on_bad_output(fake_llm, content, expected):
    fake_llm.append(_response(content, finish_reason="length"))
    data, usage = llm.call_json("reader", [], {}, name="reader")
    assert data == expected and usage["prompt"] == 0


def test_call_json_parses_fenced_json(fake_llm):
    fake_llm.append(_response('```json\n{"notes": "x", "subgoal_done": true, "answer": null}\n```'))
    data, _ = llm.call_json("reader", [], {}, name="reader")
    assert data == {"notes": "x", "subgoal_done": True, "answer": None}


def test_truncation_is_logged(fake_llm, caplog):
    fake_llm.append(_response('{"notes": "cut', finish_reason="length"))
    with caplog.at_level(logging.WARNING, logger="privsight"):
        llm.call_json("reader", [], {}, name="reader")
    assert "truncated" in caplog.text


def test_client_has_timeout_and_limited_retries():
    assert llm.client.timeout == llm.LLM_TIMEOUT_SECONDS and llm.client.max_retries == 1


def test_delete_session_with_saver_lacking_delete_thread(monkeypatch):
    class OldSaver:  # langgraph 0.2.x MemorySaver: no delete_thread
        def __init__(self):
            self.storage = {"s1": {"checkpoint": 1}, "s2": {}}

    saver = OldSaver()
    monkeypatch.setattr(main, "checkpointer", saver)
    main._delete_session("s1")  # must not raise AttributeError
    assert "s1" not in saver.storage and "s2" in saver.storage


@pytest.mark.parametrize("origin,allowed", [
    (None, True),                              # non-browser client (tests, scripts)
    ("chrome-extension://abcdefghijklmnop", True),
    ("https://evil.example", False),
    ("http://localhost:3000", False),
    ("null", False),
])
def test_websocket_origin_check(origin, allowed):
    headers = {"origin": origin} if origin else {}
    client = TestClient(main.app)
    if allowed:
        with client.websocket_connect("/ws/task", headers=headers) as ws:
            ws.send_text("{}")  # invalid message -> error reply, connection stays up
            assert "error" in ws.receive_json()
    else:
        with pytest.raises(WebSocketDisconnect) as exc:
            with client.websocket_connect("/ws/task", headers=headers):
                pass
        assert exc.value.code == 1008


def test_allowed_origins_pins_one_extension(monkeypatch):
    monkeypatch.setattr(main, "ALLOWED_ORIGINS", ["chrome-extension://mine"])
    assert main._origin_allowed("chrome-extension://mine/")
    assert not main._origin_allowed("chrome-extension://someone-else")
