"""Entry node. No LLM: compacts the snapshot and judges the last action's
outcome by comparing page signatures (replaces the old verify node, which
relied on index-based diffs and always-null form values)."""

from ...prompts import compact_elements, page_signature, short_url, strip_fragment
from ._common import append_journal


def _classify(last: dict, url: str, page_sig: str) -> tuple[str, bool | None]:
    """Returns (outcome text, progressed). progressed=None means neutral --
    an action that isn't expected to change the page."""
    if strip_fragment(url) != strip_fragment(last.get("url")):
        return f"navigated to {short_url(url)}", True
    if page_sig != last.get("page_sig"):
        return "page updated", True
    if last["type"] == "type_text" and not last.get("submit"):
        return "text entered", None
    if last["type"] == "request_user_input":
        return "user finished", None
    if last["type"] == "scroll":
        return "no new content (end of page?)", False
    return "no visible change", False


def observe(state: dict) -> dict:
    update: dict = {"pending_action": None}
    snapshot = state.get("snapshot")
    if not snapshot:
        return update

    elements = compact_elements(snapshot.get("elements") or [])
    url = snapshot.get("url") or state.get("url") or ""
    page_sig = page_signature(url, elements)
    update.update(
        snapshot=None,  # raw snapshot isn't kept in the checkpoint
        elements=elements,
        url=url,
        title=(snapshot.get("title") if snapshot.get("url") else state.get("title")) or "",
        page_sig=page_sig,
        screenshot_available=bool(snapshot.get("screenshot_available")),
    )

    last = state.get("last_action")
    if state.get("incoming") == "step" and last:
        outcome, progressed = _classify(last, url, page_sig)
        update["journal"] = append_journal(state, f"{last['desc']} → {outcome}")
        update["last_action"] = None
        if progressed is True:
            update["stuck_level"] = 0
        elif progressed is False:
            update["stuck_level"] = state.get("stuck_level", 0) + 1
    return update
