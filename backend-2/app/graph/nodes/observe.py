"""Entry node. No LLM: compacts the snapshot and judges the last action's
outcome by comparing page signatures (replaces the old verify node, which
relied on index-based diffs and always-null form values)."""

from ...prompts import compact_elements, element_hashes, overlap, page_signature, short_url, strip_fragment
from ._common import append_journal

# Below this element-set similarity the page counts as really changed. Only
# viewport elements are sent, so any small change (autocomplete dropdown,
# rotating ad, tooltip) alters page_sig without meaning the action worked.
_REAL_CHANGE = 0.7
# A submit that didn't navigate still counts if the page was mostly replaced
# (SPAs that render results in place without changing the URL).
_SPA_RESULTS = 0.5


def _classify(last: dict, url: str, page_sig: str, hashes: list[str]) -> tuple[str, bool | None]:
    """Returns (outcome text, progressed). progressed=None means neutral --
    an action that isn't expected to change the page (or only exploration)."""
    if strip_fragment(url) != strip_fragment(last.get("url")):
        return f"navigated to {short_url(url)}", True

    kind = last["type"]
    # Old checkpoints have no hashes: fall back to "any change is a change".
    similarity = overlap(last.get("hashes"), hashes) if "hashes" in last else (1.0 if page_sig == last.get("page_sig") else 0.0)

    if kind == "type_text":
        if not last.get("submit"):
            return "text entered", None
        if similarity < _SPA_RESULTS:
            return "page updated", True
        return "submitted, but the page did not navigate (the search may not have run); click the search/submit button instead of typing again", False
    if kind == "request_user_input":
        return "user finished", None
    if kind == "scroll":
        # Exploration, never progress: every scroll shows different viewport elements.
        if page_sig == last.get("page_sig"):
            return "no new content (end of page?)", False
        return "new content in view", None
    if page_sig == last.get("page_sig"):
        return "no visible change", False
    if similarity < _REAL_CHANGE:
        return "page updated", True
    return "only a small change (menu, popup or dropdown?)", None


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
        outcome, progressed = _classify(last, url, page_sig, element_hashes(elements))
        update["journal"] = append_journal(state, f"{last['desc']} → {outcome}")
        update["last_action"] = None
        if progressed is True:
            update["stuck_level"] = 0
        elif progressed is False:
            update["stuck_level"] = state.get("stuck_level", 0) + 1
    return update
