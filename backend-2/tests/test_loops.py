"""Loop detection: progress judgement (observe), fingerprints (emit) and the
actor's repeat guards. No LLM involved."""

from app.graph.nodes.actor import _validate
from app.graph.nodes.emit import emit
from app.graph.nodes.observe import observe
from app.prompts import compact_elements, page_signature

GOOGLE = "https://www.google.com/"
RESULTS = "https://www.google.com/search?q=naukri"


def raw(*labels, tag="a"):
    return [{"mark_id": i, "tag": tag, "text": text} for i, text in enumerate(labels)]


HOME = raw("Gmail", "Images", "Google Search", "I'm Feeling Lucky", "About", "Store") + [
    {"mark_id": 6, "tag": "textarea", "aria_label": "Search"}
]
# Same page after typing: Google's autocomplete dropdown appears
HOME_WITH_DROPDOWN = HOME + [{"mark_id": 7, "tag": "li", "role": "option", "text": "naukri login"}]


def page(url, raw_elements, **extra):
    """State as observe() leaves it for this page."""
    elements = compact_elements(raw_elements)
    return {"session_id": "s", "task": "search naukri", "url": url, "elements": elements,
            "page_sig": page_signature(url, elements), "journal": [], "recent_fps": [],
            "stuck_level": 0, "plan": [{"goal": "search", "done_when": "results"}], **extra}


def act(state, action):
    """emit() the action from `state`, returning the state the next observe sees."""
    return {**state, **emit({**state, "pending_action": action})}


def next_turn(state, url, raw_elements):
    """observe() the page the extension reports after the last action."""
    after = {**state, "incoming": "step", "snapshot": {"url": url, "title": "t", "elements": raw_elements}}
    return {**after, **observe(after)}


def search(target_id=6):
    return {"type": "type_text", "target_id": target_id, "text": "naukri", "submit": True}


def tool(name, **args):
    return {"id": "c1", "name": name, "arguments": {"reason": "r", **args}, "raw_arguments": "{}"}


# ── observe: honest progress ────────────────────────────────────────────────

def test_search_that_did_not_navigate_is_not_progress_even_if_dropdown_appeared():
    state = next_turn(act(page(GOOGLE, HOME), search()), GOOGLE, HOME_WITH_DROPDOWN)
    assert state["stuck_level"] == 1
    assert "did not navigate" in state["journal"][-1]
    assert "search/submit button" in state["journal"][-1]


def test_search_that_navigated_is_progress():
    state = next_turn(act(page(GOOGLE, HOME, stuck_level=1), search()), RESULTS, raw("Naukri.com - Jobs"))
    assert state["stuck_level"] == 0
    assert "navigated to" in state["journal"][-1]


def test_spa_search_that_replaced_the_page_in_place_is_progress():
    results = raw(*(f"Job result {i}" for i in range(10)))
    state = next_turn(act(page(GOOGLE, HOME), search()), GOOGLE, results)
    assert state["stuck_level"] == 0 and "page updated" in state["journal"][-1]


def test_scroll_is_neutral_not_progress():
    start = page(RESULTS, raw("r1", "r2", "r3"), stuck_level=1)
    state = next_turn(act(start, {"type": "scroll", "direction": "down"}), RESULTS, raw("r4", "r5", "r6"))
    assert state["stuck_level"] == 1  # unchanged: neither progress nor a failure
    assert "new content in view" in state["journal"][-1]


def test_click_that_only_opens_a_dropdown_is_not_progress():
    base = raw(*(f"link {i}" for i in range(10)))
    start = page(RESULTS, base, stuck_level=1)
    state = next_turn(act(start, {"type": "click", "target_id": 0}), RESULTS,
                      base + [{"mark_id": 10, "tag": "li", "role": "option", "text": "menu item"}])
    assert state["stuck_level"] == 1
    assert "small change" in state["journal"][-1]


def test_click_with_no_change_increments_stuck():
    start = page(RESULTS, raw("a", "b"))
    state = next_turn(act(start, {"type": "click", "target_id": 0}), RESULTS, raw("a", "b"))
    assert state["stuck_level"] == 1 and "no visible change" in state["journal"][-1]


def test_old_checkpoint_without_hashes_still_works():
    start = page(RESULTS, raw("a", "b"))
    state = act(start, {"type": "click", "target_id": 0})
    del state["last_action"]["hashes"]
    state = next_turn(state, RESULTS, raw("c", "d"))
    assert state["stuck_level"] == 0


# ── loop guards: fingerprints no longer depend on the viewport ─────────────

def test_resubmitting_the_same_search_on_the_same_url_is_rejected_even_if_page_sig_changed():
    state = next_turn(act(page(GOOGLE, HOME), search()), GOOGLE, HOME_WITH_DROPDOWN)
    error = _validate(tool("type_text", target_id=6, text="naukri", submit=True), state, False)
    assert error and "search/submit button" in error
    # Clicking the search button instead is fine
    assert _validate(tool("click", target_id=2), state, False) is None


def test_same_click_twice_on_same_url_is_rejected_despite_changing_viewport():
    state = page(RESULTS, raw("Next", "x"))
    for extra in ("y", "z"):
        state = next_turn(act(state, {"type": "click", "target_id": 0}), RESULTS, raw("Next", extra))
    assert "twice" in _validate(tool("click", target_id=0), state, False)


def test_scroll_down_allowed_five_times_then_rejected():
    state = page(RESULTS, raw("r0"))
    for i in range(5):
        assert _validate(tool("scroll", direction="down"), state, False) is None, f"scroll #{i + 1}"
        state = next_turn(act(state, {"type": "scroll", "direction": "down"}), RESULTS, raw(f"r{i + 1}"))
    assert "read_page" in _validate(tool("scroll", direction="down"), state, False)


def test_scrolling_back_up_after_two_downs_is_rejected():
    state = page(RESULTS, raw("r0"))
    for i in range(2):
        state = next_turn(act(state, {"type": "scroll", "direction": "down"}), RESULTS, raw(f"r{i + 1}"))
    assert "back and forth" in _validate(tool("scroll", direction="up"), state, False)


def test_scroll_limits_are_per_page():
    state = page(RESULTS, raw("r0"))
    for i in range(5):
        state = next_turn(act(state, {"type": "scroll", "direction": "down"}), RESULTS, raw(f"r{i + 1}"))
    elsewhere = next_turn(act(state, {"type": "click", "target_id": 0}), "https://www.naukri.com/", raw("Jobs"))
    assert _validate(tool("scroll", direction="down"), elsewhere, False) is None


def test_read_page_only_once_per_page_state():
    state = page(RESULTS, raw("r0"))
    assert _validate(tool("read_page"), state, False) is None
    state = act(state, {"type": "read_page"})
    assert "already read" in _validate(tool("read_page"), state, False)
