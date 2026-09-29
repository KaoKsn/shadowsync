# PrivSight backend -- privacy-preserving browser agent

## Setup

```bash
python -m venv .venv
source .venv/Scripts/activate      # Windows Git Bash; .venv/bin/activate elsewhere
pip install -r requirements.txt
cp .env.example .env               # fill in OPENAI_API_KEY
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Redis is optional but recommended. `langgraph-checkpoint-redis` needs the
RedisJSON + RediSearch modules, so use Redis Stack:

```bash
docker run -d --name privsight-redis -p 6379:6379 redis/redis-stack-server:latest
```

If Redis is unreachable (or `USE_REDIS=0`) the server logs a warning and uses
an in-memory checkpointer. `GET /health` shows which one is active.

Tests (fake LLM, no network): `pip install pytest && python -m pytest tests -q`

## How it works

The extension talks to `ws://<host>:8000/ws/task` (protocol in
[WEBSOCKET_API.md](WEBSOCKET_API.md)). Every message runs the LangGraph once
(thread = `session_id`, state checkpointed in Redis) and returns exactly one
action.

| Node | LLM | Role |
|---|---|---|
| `observe` | -- | Compacts the DOM, computes a page signature, judges the last action's outcome (navigated / page updated / no change), tracks "stuck" level. |
| `planner` | nano | Once per task: 1-5 subgoals, optional `start_url` (emitted directly as `open_url`). |
| `actor` | mini | One tool call per step. Also marks subgoals done and saves notes. |
| `reader` | nano | Turns `read_page` text into short notes, or a final answer. |
| `replanner` | nano | Only after 3 no-progress actions; max `MAX_REPLANS`, then fails cleanly. |
| `request_vision` | -- | Vision gate: asks for a screenshot on icon-only/near-empty pages or at stuck level 2, once per page state. |

### Token budget
- Static system prompt + tools first, per-turn data last, so OpenAI's prompt caching applies.
- Compact element lines (`12 a "Sign in"`), unlabeled icons collapsed, labels clipped.
- Screenshots: only on request, used for one call, downscaled to 768px JPEG and never checkpointed.
- Page text goes to the cheap reader; the actor only sees its notes.
- Per-call usage is appended to `logs/usage.jsonl` (`node`, `prompt`, `completion`, `cached`, `image`).
