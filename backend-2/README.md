# Backend scaffold -- privacy-preserving browser agent (SIH PS 26171)

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in OPENAI_API_KEY, point REDIS_URL at your Redis
uvicorn app.main:app --reload --port 8000
```

Redis must be running -- but plain `redis` won't work, `langgraph-checkpoint-redis`
needs the RedisJSON and RediSearch modules. Use Redis Stack:

```bash
docker run -d --name sih-redis -p 6379:6379 redis/redis-stack-server:latest
```

Point `REDIS_URL` at it (default in `.env.example` already matches).

## Flow

`POST /task/start` with `{session_id, task, snapshot}` kicks off a task.
Every subsequent extension update (after executing an action, or after
capturing a requested screenshot) goes to `POST /task/step` with
`{session_id, task, snapshot}` -- the response always contains exactly
one action for the extension to execute next, or a terminal
`status: "done" | "failed"` with a `summary`.

## Known things to verify before the demo, not just trust from this scaffold

- `dispatch_action -> END` + re-invoke-by-thread_id is the simplest
  pause/resume pattern, but confirm it actually resumes correctly against
  the exact `langgraph` + `langgraph-checkpoint-redis` versions you end
  up pinning -- checkpoint/resume semantics have shifted across releases.
- `verify`'s "did the diff match" logic is intentionally simple (rule-based)
  for now -- if it's too trigger-happy on retries/replans, that's the
  first thing to make smarter (e.g. LLM-escalate only on ambiguous diffs).
- Nothing here validates that elements the model references by id
  actually exist in the current snapshot -- add that guard before
  wiring up the real extension, so a hallucinated id doesn't crash
  `dispatch_action`.
