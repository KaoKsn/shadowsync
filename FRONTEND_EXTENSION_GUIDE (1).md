# Frontend Extension Guide

This document is for the browser-extension/frontend developer. It describes how the extension should talk to the backend agent and when to pause the autonomous loop for screenshots or user-entered private data.

## Core rule

The backend agent acts from the DOM snapshot the extension sends. The extension must always send the latest page state after every browser change.

## Session flow

1. Open one persistent WebSocket connection per active session.
2. Send `type: "start"` with the initial snapshot.
3. Read the returned action.
4. Execute that action in the browser.
5. Capture the new page state.
6. Send `type: "step"` with the updated snapshot.
7. Repeat until the backend returns `done` or `failed`.

## Screenshot flow

The agent can return `request_screenshot` when the visible DOM is not enough.

When that happens:

1. Capture a screenshot.
2. Send it back with `type: "screenshot"`.
3. Keep the current DOM snapshot in the payload.
4. Resume the loop after the backend responds.

The backend prompt tells the model that the screenshot is paired with the same numbered DOM mapping shown in the snapshot. The extension should preserve that numbering exactly as provided in the DOM payload.

## Login, signup, and PII pages

If the page turns into a login form, signup form, verification page, consent screen, payment screen, or any other page where the human must enter private information, the extension should stop the autonomous agent loop and hand control back to the user.

Recommended behavior:

1. Detect the gate from the DOM, URL, page title, or visible labels.
2. Pause the agent.
3. Show a modal in the frontend chat UI with a short message telling the user what information needs to be entered.
4. Put an `OK` button and a `Stop` button on that modal.
5. `OK` keeps the task paused while the user fills the form directly in the browser, then resumes the backend loop after the user clicks the page's continue, submit, login, or sign-up button.
6. `Stop` ends the current agent session and clears the active loop.
7. Capture a fresh snapshot after the user submits the form.
8. Resume the backend loop with `type: "step"`.

The backend can also return `request_user_input` for these cases. Treat that as an explicit pause signal.

Important:

- Do not send passwords, OTPs, credit cards, addresses, phone numbers, or other sensitive values back to the model.
- Only send the updated DOM snapshot and page state after the user finishes the form.
- If the form has multiple sensitive fields, let the user complete them locally before resuming.

## Snapshot requirements

The snapshot payload should contain:

- `session_id`
- `step`
- `elements`
- `changed_since_last_step`
- `screenshot_available`
- `screenshot_b64` only when the backend requested a screenshot

Each visible element should keep the same numeric `mark_id` mapping used in the DOM payload. That number is what the agent uses to decide which button or input to target.

## What the extension should execute

The backend may return one of these actions:

- `click`
- `type_text`
- `scroll`
- `request_screenshot`
- `request_user_input`
- `summarize_page`
- `task_complete`

For `request_user_input`, do not auto-fill anything. Pause, let the human enter the information, then continue once the page submits.

## Practical implementation notes

- Keep one websocket session per browser task.
- Never reuse an old snapshot after the DOM changes.
- After any user interaction or agent action, send a fresh snapshot.
- Keep screenshot capture and DOM capture aligned in the same page state.
- The pause modal should stay visible until the user clicks `OK` or `Stop`; do not auto-dismiss it.
- `OK` should resume only after the form is actually submitted and a new snapshot is available.
- `Stop` should send the backend a stop event for the current session and close or reset the task UI.