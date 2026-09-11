/**
 * PrivSight — Background Service Worker
 *
 * Responsibilities:
 *  1. Open the Side Panel when the user clicks the extension icon.
 *  2. Relay messages between the side panel and content scripts
 *     (needed because direct messaging across contexts requires a broker).
 *  3. Handle extension lifecycle events.
 */

// ── Open Side Panel on icon click across browsers ────────
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel && chrome.sidePanel.open) {
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
      if (tab.windowId) {
        chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
      }
    });
  }
});

// ── Lifecycle logging ────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  console.log('[PrivSight] Extension installed and ready (v2.0 — Side Panel).');
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
});

// ── Track connected sidepanels and popups ──────────────────
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'privsight-sidepanel' || port.name === 'privsight-popup') {
    let targetTabId = null;

    port.onMessage.addListener((msg) => {
      if (msg.type === 'AGENT_WORKING' && msg.tabId) {
        targetTabId = msg.tabId;
      } else if (msg.type === 'AGENT_IDLE') {
        targetTabId = null;
      }
    });

    port.onDisconnect.addListener(() => {
      // If the extension window closed while active, kill the in-page Aurora overlay immediately
      if (targetTabId) {
        chrome.tabs.sendMessage(targetTabId, { type: 'STOP_AGENT', immediate: true }, () => {
          void chrome.runtime.lastError;
        });
      }
      // Broadcast to active tab in lastFocusedWindow and all active tabs as a guaranteed safety measure
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        if (tabs && tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_AGENT', immediate: true }, () => {
            void chrome.runtime.lastError;
          });
        }
      });
      chrome.tabs.query({ active: true }, (tabs) => {
        tabs?.forEach((t) => {
          if (t.id) {
            chrome.tabs.sendMessage(t.id, { type: 'STOP_AGENT', immediate: true }, () => {
              void chrome.runtime.lastError;
            });
          }
        });
      });
    });
  }
});
