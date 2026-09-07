/**
 * PrivSight — Background Service Worker
 *
 * Responsibilities:
 *  1. Open the Side Panel when the user clicks the extension icon.
 *  2. Relay messages between the side panel and content scripts
 *     (needed because direct messaging across contexts requires a broker).
 *  3. Handle extension lifecycle events.
 */

// ── Open Side Panel on icon click ───────────────────────
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ── Lifecycle logging ────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  console.log('[PrivSight] Extension installed and ready (v2.0 — Side Panel).');
});
