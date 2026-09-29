# WebSocket API

Endpoint: `ws://<host>:8000/ws/task`. One connection per task; one request in flight at a time.

## Client → server

```jsonc
{ "type": "start", "session_id": "abc", "task": "Find Alan Turing's birth year", "snapshot": { ... } }
{ "type": "step", "session_id": "abc", "snapshot": { ... } }          // after executing an action
{ "type": "screenshot", "session_id": "abc", "snapshot": { ..., "screenshot_b64": "..." } } // reply to request_screenshot
{ "type": "page_text", "session_id": "abc", "page_text": "..." }       // reply to read_page
{ "type": "stop", "session_id": "abc" }
```

### Snapshot

```jsonc
{
  "session_id": "abc",
  "step": 3,
  "url": "https://en.wikipedia.org/wiki/Main_Page",   // optional but strongly recommended
  "title": "Wikipedia",
  "screenshot_available": true,
  "elements": [
    { "mark_id": 0, "tag": "input", "input_type": "search", "aria_label": "Search Wikipedia",
      "placeholder": "Search", "name": "search", "disabled": false, "redacted": false }
  ],
  "screenshot_b64": null        // only in "screenshot" messages; JPEG/PNG, data-URL prefix optional
}
```

The backend works out what changed on its own; `changed_since_last_step` is accepted but ignored.

## Server → client

```jsonc
{ "session_id": "abc", "status": "running", "action": { "type": "click", "target_id": 12, "reason": "Open the search results" } }
{ "session_id": "abc", "status": "done", "action": { "type": "task_complete", "summary": "Born 23 June 1912" }, "summary": "Born 23 June 1912" }
{ "session_id": "abc", "status": "failed", "summary": "I got stuck ..." }   // no action on failure
```

| action.type | fields | extension does |
|---|---|---|
| `click` | `target_id` | click element |
| `type_text` | `target_id`, `text`, `submit?` | set value; press Enter if `submit` |
| `scroll` | `direction` (`up`/`down`) | scroll one viewport |
| `open_url` | `url` | navigate current tab |
| `go_back` | -- | history back |
| `read_page` | -- | reply with `page_text` (redacted visible text, same step) |
| `request_screenshot` | -- | reply with `screenshot` (same step, same element numbering) |
| `request_user_input` | `message` | pause, let user fill form, then send `step` |
| `task_complete` | `summary`, `success?` | show result |

Every action carries a short `reason` for the UI.
