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

// ── Execution State Persistence (chrome.storage.session) ──
const SESSION_STATE_KEY = 'privsight_execution_state';

async function getExecutionState() {
  return new Promise((resolve) => {
    if (!chrome.storage?.session) {
      resolve(null);
      return;
    }
    chrome.storage.session.get([SESSION_STATE_KEY], (res) => {
      resolve(res?.[SESSION_STATE_KEY] || null);
    });
  });
}

async function setExecutionState(state) {
  return new Promise((resolve) => {
    if (!chrome.storage?.session) {
      resolve();
      return;
    }
    chrome.storage.session.set({ [SESSION_STATE_KEY]: state }, () => {
      resolve();
    });
  });
}

async function clearExecutionState() {
  return new Promise((resolve) => {
    if (!chrome.storage?.session) {
      resolve();
      return;
    }
    chrome.storage.session.remove([SESSION_STATE_KEY], () => {
      resolve();
    });
  });
}

// ── Track connected sidepanels, popups, and content scripts ─
chrome.runtime.onConnect.addListener((port) => {
  // Content script connection (agent.js)
  if (port.name === 'privsight-agent') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'GET_STATE') {
        const state = await getExecutionState();
        try {
          port.postMessage({ type: 'STATE_RESPONSE', state });
        } catch (_) {
          // Port closed during navigation/bfcache transition; quietly ignore
        }
      } else if (msg.type === 'STEP_DONE') {
        const state = await getExecutionState();
        if (state) {
          state.stepIndex = (state.stepIndex || 0) + 1;
          state.lastStepResult = msg.result || null;
          state.updatedAt = Date.now();
          await setExecutionState(state);
        }
      }
    });

    port.onDisconnect.addListener(() => {
      // Expected lifecycle event during tab navigation or bfcache; do not treat as error
      void chrome.runtime.lastError;
      console.debug('[PrivSight Background] Content script port disconnected (normal navigation/bfcache).');
    });
    return;
  }

  // Side panel / popup connection
  if (port.name === 'privsight-sidepanel' || port.name === 'privsight-popup') {
    let targetTabId = null;

    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'AGENT_WORKING' && msg.tabId) {
        targetTabId = msg.tabId;
        const state = (await getExecutionState()) || {};
        state.tabId = msg.tabId;
        state.isOverlayActive = true;
        state.updatedAt = Date.now();
        await setExecutionState(state);
      } else if (msg.type === 'AGENT_IDLE') {
        targetTabId = null;
        const state = await getExecutionState();
        if (state) {
          state.isOverlayActive = false;
          state.updatedAt = Date.now();
          await setExecutionState(state);
        }
      } else if (msg.type === 'SESSION_START') {
        targetTabId = msg.tabId || targetTabId;
        const state = {
          sessionId: msg.sessionId,
          tabId: msg.tabId,
          taskGoal: msg.taskGoal || '',
          domain: msg.domain || '',
          status: 'running',
          isRunning: true,
          isOverlayActive: true,
          stepIndex: 0,
          updatedAt: Date.now(),
        };
        await setExecutionState(state);
      } else if (msg.type === 'SESSION_UPDATE') {
        const state = (await getExecutionState()) || {};
        Object.assign(state, msg.data || {}, { updatedAt: Date.now() });
        await setExecutionState(state);
      } else if (msg.type === 'SESSION_END') {
        await clearExecutionState();
      }
    });

    port.onDisconnect.addListener(async () => {
      const disconnectedTabId = targetTabId;
      // Debounce disconnect cleanup to avoid killing Aurora overlay during normal MV3 port recycles
      setTimeout(async () => {
        const state = await getExecutionState();
        if (!state || !state.isRunning) {
          await clearExecutionState();
          if (disconnectedTabId) {
            chrome.tabs.sendMessage(disconnectedTabId, { type: 'STOP_AGENT', immediate: true }, () => {
              void chrome.runtime.lastError;
            });
          }
        }
      }, 2500);
    });
  }
});

// ── Relay and Message Support ───────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_VISIBLE_TAB') {
    const windowId = sender.tab?.windowId || null;
    try {
      chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.warn('[PrivSight SW] captureVisibleTab error:', chrome.runtime.lastError.message);
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, dataUrl });
        }
      });
    } catch (err) {
      console.warn('[PrivSight SW] captureVisibleTab exception:', err);
      sendResponse({ ok: false, error: err.message });
    }
    return true; // Keep message channel open for asynchronous sendResponse
  }

  if (message.action === 'UPDATE_CLICKABLES') {
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

