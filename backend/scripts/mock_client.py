"""
Stateful smoke test -- simulates real page transitions (Google home ->
results -> Wikipedia) so the model gets genuine progress signals and the
loop terminates naturally via task_complete/summarize_page.

Usage:
    export API_BASE=http://localhost:8000   # optional, default shown
    python scripts/mock_client.py
"""

import os
import uuid

import requests

API_BASE = os.getenv("API_BASE", "http://localhost:8000")
SESSION_ID = str(uuid.uuid4())

GOOGLE_HOME = [
    {"id": 3, "tag": "input", "role": "textbox", "input_type": "text",
     "text": None, "value": "", "redacted": False},
    {"id": 4, "tag": "button", "role": "button", "text": "Google Search",
     "value": None, "redacted": False},
]

RESULTS_PAGE = [
    {"id": 10, "tag": "a", "role": "link", "text": "Node.js - Wikipedia",
     "value": None, "redacted": False},
    {"id": 11, "tag": "a", "role": "link", "text": "Node.js (nodejs.org)",
     "value": None, "redacted": False},
]

WIKIPEDIA_PAGE = [
    {"id": 20, "tag": "h1", "role": "heading", "text": "Node.js",
     "value": None, "redacted": False},
    {"id": 21, "tag": "p", "role": None,
     "text": "Node.js is an open-source, cross-platform runtime environment.",
     "value": None, "redacted": False},
]


class FakeBrowser:
    """Tracks one page and decides the next page based on the action applied."""

    def __init__(self):
        self.page_name = "google_home"
        self.elements = [dict(e) for e in GOOGLE_HOME]

    def snapshot_dict(self, step: int, changed=None):
        return {
            "session_id": SESSION_ID,
            "step": step,
            "elements": self.elements,
            "changed_since_last_step": changed or [],
            "screenshot_available": False,
            "screenshot_b64": None,
        }

    def apply(self, action: dict):
        a_type = action.get("type")
        target = action.get("target_id")

        if self.page_name == "google_home":
            if a_type == "type_text" and target == 3:
                for el in self.elements:
                    if el["id"] == 3:
                        el["value"] = action.get("text", "")
                return [3]
            if a_type == "click" and target == 4:
                self.page_name = "results"
                self.elements = [dict(e) for e in RESULTS_PAGE]
                return [10, 11]

        if self.page_name == "results":
            if a_type == "click" and target == 10:
                self.page_name = "wikipedia"
                self.elements = [dict(e) for e in WIKIPEDIA_PAGE]
                return [20, 21]

        # wikipedia page (or any unmatched action): nothing changes --
        # the model should call task_complete/summarize_page here
        return []


def main():
    task = "Search 'Nodejs' on Google and open the Wikipedia result."
    browser = FakeBrowser()

    snapshot = browser.snapshot_dict(step=0)
    resp = requests.post(
        f"{API_BASE}/task/start",
        json={"session_id": SESSION_ID, "task": task, "snapshot": snapshot},
    )
    resp.raise_for_status()
    result = resp.json()
    print(f"[step 0] status={result['status']} action={result.get('action')}")

    step = 1
    while result["status"] == "running" and step < 15:
        action = result["action"]
        changed = browser.apply(action)
        snapshot = browser.snapshot_dict(step=step, changed=changed)

        resp = requests.post(
            f"{API_BASE}/task/step",
            json={"session_id": SESSION_ID, "task": task, "snapshot": snapshot},
        )
        resp.raise_for_status()
        result = resp.json()
        print(f"[step {step}] status={result['status']} action={result.get('action')}")
        step += 1

    print("\nFinal result:", result)


if __name__ == "__main__":
    main()