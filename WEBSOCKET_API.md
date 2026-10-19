# WebSocket API for the browser extension

This document explains how to move the extension from the old HTTP flow to the new WebSocket flow.

The current HTTP API remains available in [backend/app/main.py](backend/app/main.py), but the extension can use the WebSocket backend in [backend/app/websocket_main.py](backend/app/websocket_main.py) instead.

## Endpoint

- WS: `ws://localhost:8001/ws/task`
- or `wss://<your-host>/ws/task` in production

## Why use WebSocket

WebSocket is better for an extension that needs a long-running agent session because:

- the same session stays alive across multiple steps
- the extension does not need to re-open HTTP requests repeatedly
- it is a more natural fit for a step-by-step browser agent loop

## Message format

Every message is a JSON string.

### 1) Start a task

Send:

```json
{
  "type": "start",
  "session_id": "session-123",
  "task": "Search for Node.js on Google and open the Wikipedia result.",
  "snapshot": {
    "session_id": "session-123",
    "step": 0,
    "elements": [
      {
        "mark_id": 3,
        "tag": "input",
        "role": "textbox",
        "input_type": "text",
        "text": null,
        "value": "",
        "redacted": false,
        "redaction_reason": null
      }
    ],
    "changed_since_last_step": [],
    "screenshot_available": false,
    "screenshot_b64": null
  }
}
```

Response:

```json
{
  "session_id": "session-123",
  "status": "running",
  "action": {
    "type": "type_text",
    "target_id": 3,
    "text": "Node.js"
  },
  "summary": null
}
```

### 2) Send next step after action result

After the extension executes the returned action, send the updated snapshot back:

```json
{
  "type": "step",
  "session_id": "session-123",
  "task": "Search for Node.js on Google and open the Wikipedia result.",
  "snapshot": {
    "session_id": "session-123",
    "step": 1,
    "elements": [
      {
        "mark_id": 3,
        "tag": "input",
        "role": "textbox",
        "input_type": "text",
        "text": null,
        "value": "Node.js",
        "redacted": false,
        "redaction_reason": null
      }
    ],
    "changed_since_last_step": [3],
    "screenshot_available": false,
    "screenshot_b64": null
  }
}
```

### 3) Send screenshot result

If the agent asked for a screenshot:

```json
{
  "type": "screenshot",
  "session_id": "session-123",
  "task": "Search for Node.js on Google and open the Wikipedia result.",
  "snapshot": {
    "session_id": "session-123",
    "step": 4,
    "elements": [],
    "changed_since_last_step": [],
    "screenshot_available": true,
    "screenshot_b64": "<base64-encoded-image>"
  }
}
```

### 4) Stop a session

```json
{
  "type": "stop",
  "session_id": "session-123"
}
```

## Response shape

The server responds with:

```json
{
  "session_id": "session-123",
  "status": "running",
  "action": {
    "type": "click",
    "target_id": 10
  },
  "summary": null
}
```

Possible final statuses:

- `running`: more work to do
- `done`: task completed
- `failed`: task failed

The `action` field may be `null` when the response is not asking for an action.

## Extension flow

1. Open a WebSocket connection once.
2. Generate a stable `session_id`.
3. Send the initial snapshot with `type: "start"`.
4. Read the returned `action`.
5. Execute the action in the browser.
6. Read the new page state and send a new snapshot with `type: "step"`.
7. Repeat until `status` is `done` or `failed`.
8. If the agent requests a screenshot, send the screenshot with `type: "screenshot"`.

## Example JavaScript client

```js
const ws = new WebSocket("ws://localhost:8001/ws/task");

const sessionId = "session-123";

ws.onopen = () => {
  const payload = {
    type: "start",
    session_id: sessionId,
    task: "Search for Node.js on Google and open the Wikipedia result.",
    snapshot: {
      session_id: sessionId,
      step: 0,
      elements: [],
      changed_since_last_step: [],
      screenshot_available: false,
      screenshot_b64: null
    }
  };

  ws.send(JSON.stringify(payload));
};

ws.onmessage = (event) => {
  const resp = JSON.parse(event.data);
  console.log("server response:", resp);

  if (resp.status === "running" && resp.action) {
    // execute action on browser here
    // then send updated snapshot back to websocket
  }
};
```

## Important differences from HTTP

The HTTP version uses:

- `POST /task/start`
- `POST /task/step`
- `POST /task/screenshot`
- `POST /task/stop`

The WebSocket version uses one persistent connection and sends JSON messages with a `type` field instead.

This backend intentionally keeps WebSocket state in memory only; it does not store websocket session state in Redis.

## Notes for the frontend

- Use one connection per active session.
- Keep `session_id` stable during the whole flow.
- Do not reuse stale snapshots.
- Always send the latest browser state after execution.
- If the agent returns `request_screenshot`, capture the screenshot and send it back using `type: "screenshot"`.

## Files involved

- HTTP backend: [backend/app/main.py](backend/app/main.py)
- WebSocket backend: [backend/app/websocket_main.py](backend/app/websocket_main.py)
- Shared schema: [backend/app/schemas.py](backend/app/schemas.py)
