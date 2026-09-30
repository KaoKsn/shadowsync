/**
 * PrivSight — Side Panel JavaScript (sidepanel.js)
 *
 * Drives the live privacy-preserving browser agent:
 *  1. Captures sanitized DOM + redacted screenshot (PII scrubbed, faces redacted, hint badges added)
 *  2. Dispatches turns to backend at http://localhost:8000 (POST /turn)
 *  3. Executes autonomous actions (CLICK, TYPE, SCROLL, NEW_TAB, GO_BACK, GO_FORWARD) in the live webpage
 *  4. Supports Human-in-the-loop (USER) pauses for 2FA, OTP, Captcha with Resume / Cancel
 *  5. Terminates on DONE or explicit user stop (DELETE /session/{session_id})
 */

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  // STATE
  // ══════════════════════════════════════════════════════════════
  let activeTabId = null;
  let sessionPort = null;
  let currentSessionId = null;
  let isLoopPausedForUser = false;
  let userResumeResolver = null;
  let activeLoopAborted = false;

  function initSessionPort() {
    try {
      sessionPort = chrome.runtime.connect({ name: 'privsight-sidepanel' });
      sessionPort.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        sessionPort = null;
      });
    } catch (e) {
      console.debug('[PrivSight] Port connect:', e);
    }
  }

  function sendSessionMessage(msg) {
    if (!sessionPort) {
      initSessionPort();
    }
    if (sessionPort) {
      try {
        sessionPort.postMessage(msg);
      } catch (_) {}
    }
  }

  initSessionPort();

  /**
   * currentStatus — tracks the agent's lifecycle stage.
   * Valid values: 'idle' | 'connecting' | 'reading_page' | 'protecting_data'
   *               'understanding_page' | 'planning' | 'executing'
   *               'user_action' | 'completed' | 'error'
   */
  let currentStatus = 'idle';

  /** Chat message history */
  let messages = [];

  /** Privacy pipeline counters */
  let stats = {
    dataFound: 0,
    sensitiveRecognized: 0,
    sensitiveRemoved: 0,
  };

  let activeSession = null;

  // ── Status metadata ─────────────────────────────────────────
  const STATUS_META = {
    idle:               { label: 'Ready',       dotClass: 'ready',     working: false },
    connecting:         { label: 'Connecting',  dotClass: 'working',   working: true  },
    reading_page:       { label: 'Scanning',    dotClass: 'working',   working: true  },
    protecting_data:    { label: 'Protecting',  dotClass: 'working',   working: true  },
    understanding_page: { label: 'Thinking',    dotClass: 'working',   working: true  },
    planning:           { label: 'Planning',    dotClass: 'working',   working: true  },
    executing:          { label: 'Executing',   dotClass: 'working',   working: true  },
    user_action:        { label: 'Action Needed', dotClass: 'working', working: true },
    completed:          { label: 'Completed',   dotClass: 'completed', working: false },
    error:              { label: 'Error',       dotClass: 'error',     working: false },
  };

  // ── Agent activity steps ──
  const ACTIVITY_STEPS = [
    { id: 'connect',    label: 'Connecting to agent',         status: 'connecting'         },
    { id: 'read',       label: 'Sanitizing DOM & screenshot', status: 'reading_page'       },
    { id: 'protect',    label: 'Scrubbing sensitive PII',     status: 'protecting_data'    },
    { id: 'plan',       label: 'Evaluating next action',      status: 'planning'           },
    { id: 'execute',    label: 'Executing action on page',    status: 'executing'          },
  ];

  // ══════════════════════════════════════════════════════════════
  // DOM REFERENCES
  // ══════════════════════════════════════════════════════════════
  const $ = (id) => document.getElementById(id);

  const el = {
    header:          $('ps-toolbar') || $('ps-header'),
    logo:            $('ps-logo'),
    statusDot:       $('ps-status-dot'),
    statusText:      $('ps-status-text'),
    dashboardBtn:    $('ps-dashboard-btn'),
    profileBtn:      $('ps-profile-btn'),
    closeBtn:        $('ps-close-btn'),
    chat:            $('ps-chat'),
    idle:            $('ps-idle'),
    activity:        $('ps-activity'),
    activityTitle:   $('ps-activity-title'),
    activitySteps:   $('ps-activity-steps'),
    quickActions:    $('ps-quick-actions'),
    input:           $('ps-input'),
    sendBtn:         $('ps-send-btn'),
    privacyBadge:    $('ps-privacy-badge'),
    privacyBadgeTxt: $('ps-privacy-badge-text'),
    privDot:         $('ps-priv-dot'),
    statFound:       $('ps-stat-found'),
    statRecognized:  $('ps-stat-recognized'),
    statRemoved:     $('ps-stat-removed'),
    barFill:         $('ps-privacy-bar-fill'),
    userPrompt:      $('ps-user-prompt'),
    userPromptText:  $('ps-user-prompt-text'),
    resumeBtn:       $('ps-resume-btn'),
    cancelBtn:       $('ps-cancel-btn'),
    userPromptTitle: $('ps-user-prompt-title'),
    autofillYesBtn:  $('ps-autofill-yes'),
    autofillNoBtn:   $('ps-autofill-no'),
  };

  // ══════════════════════════════════════════════════════════════
  // THEME MANAGEMENT
  // ══════════════════════════════════════════════════════════════
  function initTheme() {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  // ══════════════════════════════════════════════════════════════
  // TAB RESOLUTION & MESSAGING
  // ══════════════════════════════════════════════════════════════
  async function resolveActiveTab() {
    if (activeTabId) {
      const existingTab = await new Promise((resolve) => {
        chrome.tabs.get(activeTabId, (tab) => {
          if (!chrome.runtime.lastError && tab && tab.id) {
            resolve(tab);
          } else {
            resolve(null);
          }
        });
      });
      if (existingTab) {
        return existingTab;
      }
    }

    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const valid = tabs?.find((t) => t.id && !t.url?.startsWith('chrome-extension://'));
        if (valid) {
          activeTabId = valid.id;
          resolve(valid);
          return;
        }
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs2) => {
          const valid2 = tabs2?.find((t) => t.id && !t.url?.startsWith('chrome-extension://'));
          if (valid2) {
            activeTabId = valid2.id;
            resolve(valid2);
            return;
          }
          chrome.tabs.query({ active: true }, (tabs3) => {
            const valid3 = tabs3?.find((t) => t.id && !t.url?.startsWith('chrome-extension://')) || tabs3?.[0];
            if (valid3 && valid3.id) {
              activeTabId = valid3.id;
              resolve(valid3);
            } else {
              resolve(null);
            }
          });
        });
      });
    });
  }

  function isRestrictedUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return (
      url.startsWith('chrome://') ||
      url.startsWith('brave://') ||
      url.startsWith('edge://') ||
      (url.startsWith('about:') && url !== 'about:blank') ||
      url.startsWith('chrome-extension://')
    );
  }

  function isNavigationOrBfcacheError(err) {
    const msg = typeof err === 'string' ? err : (err?.message || '');
    return (
      msg.includes('back/forward cache') ||
      msg.includes('message channel is closed') ||
      msg.includes('Receiving end does not exist') ||
      msg.includes('Frame was removed') ||
      msg.includes('context invalidated')
    );
  }

  function waitForTabReady(tabId, timeoutMs = 12000) {
    return new Promise((resolve) => {
      let resolved = false;
      let timer = null;

      function finish() {
        if (!resolved) {
          resolved = true;
          chrome.tabs.onUpdated.removeListener(onUpdated);
          if (timer) clearTimeout(timer);
          resolve();
        }
      }

      function onUpdated(updatedTabId, changeInfo) {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          setTimeout(finish, 400);
        }
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
      timer = setTimeout(finish, timeoutMs);

      chrome.tabs.get(tabId, (t) => {
        if (chrome.runtime.lastError || !t) {
          finish();
          return;
        }
        if (t.status === 'complete') {
          setTimeout(finish, 400);
        }
      });
    });
  }

  /**
   * Wait for a triggered navigation to complete (loading -> complete),
   * handling bfcache, instant transitions, and safety fallbacks.
   */
  function waitForNavigation(tabId, triggerNavFn, timeoutMs = 15000) {
    return new Promise(async (resolve) => {
      let resolved = false;
      let timer = null;
      let sawLoading = false;

      function finish() {
        if (!resolved) {
          resolved = true;
          chrome.tabs.onUpdated.removeListener(onUpdated);
          if (timer) clearTimeout(timer);
          resolve();
        }
      }

      function onUpdated(updatedTabId, changeInfo) {
        if (updatedTabId === tabId) {
          if (changeInfo.status === 'loading') {
            sawLoading = true;
          } else if (changeInfo.status === 'complete') {
            setTimeout(finish, 500);
          }
        }
      }

      chrome.tabs.onUpdated.addListener(onUpdated);
      timer = setTimeout(finish, timeoutMs);

      if (typeof triggerNavFn === 'function') {
        try {
          await triggerNavFn();
        } catch (err) {
          console.warn('[PrivSight] Error during navigation trigger:', err);
        }
      }

      // If navigation didn't fire 'loading' (e.g. instant bfcache, about:blank, or history boundary)
      setTimeout(() => {
        if (!sawLoading && !resolved) {
          chrome.tabs.get(tabId, (t) => {
            if (chrome.runtime.lastError || !t || t.status === 'complete') {
              finish();
            }
          });
        }
      }, 1500);
    });
  }

  /**
   * Request content script to capture sanitized DOM and screenshot
   */
  async function captureActiveTabState(retries = 2) {
    const tab = await resolveActiveTab();
    if (!tab?.id || isRestrictedUrl(tab.url)) {
      throw new Error('PrivSight cannot inspect internal browser pages (' + (tab?.url || 'unknown') + '). Please switch to a regular web page.');
    }

    // Ensure the tab has completely finished loading before taking screenshot & capturing state
    await waitForTabReady(tab.id);

    return new Promise((resolve, reject) => {
      function attempt(attemptsLeft) {
        chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_STATE' }, (resp) => {
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message || '';
            if (isNavigationOrBfcacheError(errMsg) && attemptsLeft > 0) {
              setTimeout(() => attempt(attemptsLeft - 1), 600);
              return;
            }
            reject(new Error('Content script communication error: ' + errMsg));
          } else if (!resp?.ok) {
            reject(new Error(resp?.error || 'Failed to capture page state'));
          } else {
            resolve(resp.data);
          }
        });
      }
      attempt(retries);
    });
  }

  /**
   * Request content script to execute action (CLICK, TYPE, SCROLL)
   */
  async function executeTabAction(action) {
    const tab = await resolveActiveTab();
    if (!tab?.id) {
      throw new Error('No active browser tab found for action execution.');
    }

    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { type: 'EXECUTE_ACTION', action }, async (resp) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || '';
          if (isNavigationOrBfcacheError(errMsg)) {
            console.debug('[PrivSight Loop] Navigation/bfcache transition detected during action execution. Waiting for new page...');
            await waitForTabReady(tab.id);
            await lockPage();
            resolve({ ok: true, navigated: true });
            return;
          }
          reject(new Error('Action execution failed: ' + errMsg));
        } else if (!resp?.ok) {
          reject(new Error(resp?.error || 'Action execution returned false'));
        } else {
          resolve(resp.result);
        }
      });
    });
  }

  /**
   * Toggle overlay interactive mode for human action steps
   */
  async function setUserInteractiveMode(enabled) {
    const tab = await resolveActiveTab();
    if (!tab?.id) return;
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(
        tab.id,
        { type: enabled ? 'PAUSE_USER_MODE' : 'RESUME_AGENT_MODE' },
        () => resolve()
      );
    });
  }

  function waitForHumanFormSubmission(tabId) {
    return new Promise((resolve) => {
      const finish = (result) => {
        chrome.runtime.onMessage.removeListener(onMessage);
        chrome.tabs.onRemoved.removeListener(onTabRemoved);
        if (userResumeResolver === finish) userResumeResolver = null;
        resolve(result);
      };
      const onMessage = (message, sender) => {
        if (message?.type === 'PRIVSIGHT_HUMAN_FORM_SUBMITTED' && sender.tab?.id === tabId) finish('submitted');
      };
      const onTabRemoved = (removedTabId) => {
        if (removedTabId === tabId) finish('stop');
      };
      userResumeResolver = finish;
      chrome.runtime.onMessage.addListener(onMessage);
      chrome.tabs.onRemoved.addListener(onTabRemoved);
    });
  }

  /**
   * Messages the page's autofill module; resolves null if it isn't there.
   * Time-limited: agent.js keeps every message channel open (`return true`),
   * so if autofill isn't running in the tab (e.g. a tab open before an
   * extension reload) no reply would ever come and the pause would hang.
   */
  function sendAutofillMessage(tabId, type, timeoutMs = 1500) {
    return new Promise((resolve) => {
      if (!tabId) return resolve(null);
      const timer = setTimeout(() => resolve(null), timeoutMs);
      chrome.tabs.sendMessage(tabId, { type }, (response) => {
        clearTimeout(timer);
        resolve(chrome.runtime.lastError || !response?.ok ? null : response);
      });
    });
  }

  /** Swaps the prompt between the Yes/No autofill question and OK/Stop. */
  function showAutofillQuestion(visible) {
    const show = (node, on) => { if (node) node.style.display = on ? '' : 'none'; };
    show(el.autofillYesBtn, visible);
    show(el.autofillNoBtn, visible);
    show(el.resumeBtn, !visible);
    show(el.cancelBtn, !visible);
    if (el.userPromptTitle) el.userPromptTitle.textContent = visible ? 'Autofill this page?' : 'Your input is needed';
  }

  /** Resolves 'yes' | 'no' from the prompt buttons (or 'ended' via `ended`). */
  function askAutofill(ended) {
    return new Promise((resolve) => {
      const done = (answer) => {
        el.autofillYesBtn?.removeEventListener('click', onYes);
        el.autofillNoBtn?.removeEventListener('click', onNo);
        resolve(answer);
      };
      const onYes = () => done('yes');
      const onNo = () => done('no');
      el.autofillYesBtn?.addEventListener('click', onYes);
      el.autofillNoBtn?.addEventListener('click', onNo);
      ended.then(() => done('ended'));
    });
  }

  async function pauseForHumanInput(instruction) {
    const tabId = activeTabId;
    updateAgentStatus('user_action');
    renderActivity(null);
    if (tabId) chrome.tabs.sendMessage(tabId, { type: 'PAUSE_PII_AUTOFILL_FOR_HUMAN_INPUT' }, () => void chrome.runtime.lastError);
    await setUserInteractiveMode(true);
    isLoopPausedForUser = true;
    if (el.userPromptText) el.userPromptText.textContent = instruction;
    if (el.resumeBtn) {
      el.resumeBtn.textContent = 'OK';
      el.resumeBtn.disabled = false;
    }
    if (el.cancelBtn) el.cancelBtn.textContent = 'Stop';

    const resultPromise = waitForHumanFormSubmission(tabId);
    // Watch for the submit immediately; the user may submit without clicking OK.
    if (tabId) chrome.tabs.sendMessage(tabId, { type: 'ARM_HUMAN_SUBMIT' }, () => void chrome.runtime.lastError);

    // Ask before filling anything from the profile on a page handed to the user.
    // Only field names come back from the page, never profile values.
    const offer = await sendAutofillMessage(tabId, 'PII_AUTOFILL_PREVIEW');
    if (offer?.count > 0) {
      if (el.userPromptText) {
        el.userPromptText.textContent =
          `PrivSight can fill ${offer.labels.join(', ')} on this page from your saved profile. ` +
          'Passwords and one-time codes are never filled — you enter those yourself.';
      }
      showAutofillQuestion(true);
      if (el.userPrompt) el.userPrompt.style.display = 'flex';

      const answer = await askAutofill(resultPromise);
      showAutofillQuestion(false);
      if (answer === 'yes') {
        const filled = await sendAutofillMessage(tabId, 'PII_AUTOFILL_CONSENT_FILL');
        if (el.userPromptText) {
          el.userPromptText.textContent = filled?.count
            ? `Filled ${filled.labels.join(', ')} from your profile. Check it, enter anything else (like your password) on the page, then submit. PrivSight will resume after submission.`
            : instruction;
        }
      } else if (el.userPromptText) {
        el.userPromptText.textContent = instruction;
      }
    }
    if (el.userPrompt) el.userPrompt.style.display = 'flex';

    const result = await resultPromise;
    isLoopPausedForUser = false;
    showAutofillQuestion(false);
    if (el.userPrompt) el.userPrompt.style.display = 'none';
    if (el.resumeBtn) {
      el.resumeBtn.textContent = 'OK';
      el.resumeBtn.disabled = false;
    }

    if (result === 'submitted') {
      await waitForTabReady(tabId).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (tabId) chrome.tabs.sendMessage(tabId, { type: 'RESUME_PII_AUTOFILL' }, () => void chrome.runtime.lastError);
      // Same-document (SPA) submits keep the old overlay, which is still in
      // interactive mode; switch it back before re-locking.
      await setUserInteractiveMode(false);
      await lockPage();
    }
    // On stop/cancel the loop's cleanup (or stopAgent) unlocks the page, so
    // re-entering agent mode here would only race with that unlock.
    return result;
  }

  // ══════════════════════════════════════════════════════════════
  // OVERLAY CONTROLS
  // ══════════════════════════════════════════════════════════════
  async function unlockTab(tabId) {
    if (!tabId) return;
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'STOP_AGENT', immediate: true }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }

  async function lockPage() {
    let tab = await resolveActiveTab();
    if (!tab?.id && activeTabId) {
      tab = await new Promise((resolve) => {
        chrome.tabs.get(activeTabId, (t) => {
          if (!chrome.runtime.lastError && t) resolve(t);
          else resolve(null);
        });
      });
    }
    if (!tab?.id || isRestrictedUrl(tab.url)) return;

    activeTabId = tab.id;
    const targetId = activeTabId;

    return new Promise((resolve) => {
      chrome.tabs.sendMessage(targetId, { type: 'START_AGENT' }, (response) => {
        if (!chrome.runtime.lastError && response?.ok) {
          sendSessionMessage({ type: 'AGENT_WORKING', tabId: targetId });
          resolve();
          return;
        }

        if (chrome?.scripting?.executeScript) {
          chrome.scripting.executeScript(
            {
              target: { tabId: targetId },
              files: [
                'content/html2canvas.min.js',
                'content/redactor.js',
                'content/faceRedaction.js',
                'content/qrMask.js',
                'content/pii-config.js',
                'content/pii-autofill.js',
                'content/pii-guard.js',
                'content/agent.js',
              ],
            },
            () => {
              chrome.tabs.sendMessage(targetId, { type: 'START_AGENT' }, () => {
                sendSessionMessage({ type: 'AGENT_WORKING', tabId: targetId });
                resolve();
              });
            }
          );
        } else {
          resolve();
        }
      });
    });
  }

  async function unlockPage(tabIdToUnlock) {
    sendSessionMessage({ type: 'AGENT_IDLE' });
    let targetId = tabIdToUnlock || activeTabId;
    if (!targetId) {
      const tab = await resolveActiveTab();
      targetId = tab?.id;
    }
    if (!targetId) return;
    return unlockTab(targetId);
  }

  /**
   * Request browser to open a new tab and switch active context (NEW_TAB)
   */
  async function executeNewTabAction(action) {
    const oldTabId = activeTabId;
    if (oldTabId) {
      await unlockTab(oldTabId);
    }

    let targetUrl = action?.url ? String(action.url).trim() : '';
    if (!targetUrl) {
      targetUrl = 'about:blank';
    } else if (!/^[a-zA-Z]+:\/\//.test(targetUrl) && !targetUrl.startsWith('about:')) {
      targetUrl = 'https://' + targetUrl;
    }

    const newTab = await new Promise((resolve, reject) => {
      chrome.tabs.create({ url: targetUrl, active: true }, (tab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(tab);
        }
      });
    });

    if (!newTab?.id) {
      throw new Error('Failed to create new browser tab.');
    }

    // Switch active tab tracking to the new tab
    activeTabId = newTab.id;

    // Ensure the new tab is actively focused
    await new Promise((resolve) => {
      chrome.tabs.update(newTab.id, { active: true }, () => resolve());
    });

    // Wait for the new tab to finish loading
    await waitForTabReady(newTab.id);

    // Sync session and background worker with the new tabId
    sendSessionMessage({ type: 'AGENT_WORKING', tabId: activeTabId });
    sendSessionMessage({ type: 'SESSION_UPDATE', data: { tabId: activeTabId } });

    // Lock page with Aurora overlay
    await lockPage();

    return { ok: true, navigated: true, tabId: activeTabId, actionType: 'NEW_TAB' };
  }

  /**
   * Request browser native history back navigation on current active tab (GO_BACK)
   */
  async function executeGoBackAction() {
    const tab = await resolveActiveTab();
    if (!tab?.id) {
      throw new Error('No active browser tab found for GO_BACK.');
    }

    await waitForNavigation(tab.id, () => {
      return new Promise((resolve) => {
        chrome.tabs.goBack(tab.id, () => {
          if (chrome.runtime.lastError) {
            console.warn('[PrivSight Loop] chrome.tabs.goBack notice:', chrome.runtime.lastError.message);
          }
          resolve();
        });
      });
    });

    await lockPage();
    return { ok: true, navigated: true, tabId: tab.id, actionType: 'GO_BACK' };
  }

  /**
   * Request browser native history forward navigation on current active tab (GO_FORWARD)
   */
  async function executeGoForwardAction() {
    const tab = await resolveActiveTab();
    if (!tab?.id) {
      throw new Error('No active browser tab found for GO_FORWARD.');
    }

    await waitForNavigation(tab.id, () => {
      return new Promise((resolve) => {
        chrome.tabs.goForward(tab.id, () => {
          if (chrome.runtime.lastError) {
            console.warn('[PrivSight Loop] chrome.tabs.goForward notice:', chrome.runtime.lastError.message);
          }
          resolve();
        });
      });
    });

    await lockPage();
    return { ok: true, navigated: true, tabId: tab.id, actionType: 'GO_FORWARD' };
  }

  /**
   * Navigate the current tab to a URL (NAVIGATE / backend open_url)
   */
  async function executeNavigateAction(action) {
    const tab = await resolveActiveTab();
    if (!tab?.id) {
      throw new Error('No active browser tab found for NAVIGATE.');
    }

    let targetUrl = action?.url ? String(action.url).trim() : '';
    if (!targetUrl) throw new Error('NAVIGATE requires a url.');
    if (!/^[a-zA-Z]+:\/\//.test(targetUrl)) targetUrl = 'https://' + targetUrl;

    await waitForNavigation(tab.id, () => {
      return new Promise((resolve) => {
        chrome.tabs.update(tab.id, { url: targetUrl }, () => {
          if (chrome.runtime.lastError) {
            console.warn('[PrivSight Loop] chrome.tabs.update notice:', chrome.runtime.lastError.message);
          }
          resolve();
        });
      });
    });

    await waitForTabReady(tab.id);
    await lockPage();
    return { ok: true, navigated: true, tabId: tab.id, actionType: 'NAVIGATE' };
  }

  /**
   * Ask the content script for the page's redacted visible text (READ_PAGE)
   */
  async function readActiveTabText(maxChars = 6000) {
    const tab = await resolveActiveTab();
    if (!tab?.id) return '';
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: 'READ_PAGE', maxChars }, (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) {
          console.warn('[PrivSight Loop] READ_PAGE failed:', chrome.runtime.lastError?.message || resp?.error);
          resolve('');
        } else {
          resolve(resp.text || '');
        }
      });
    });
  }

  // ══════════════════════════════════════════════════════════════
  // AGENT EXECUTION LOOP (Backend Integration Guide)
  // ══════════════════════════════════════════════════════════════
  // The backend enforces the real step budget; this is only a runaway guard.
  const MAX_SAFETY_TURNS = 40;

  /**
   * startAgent(prompt)
   * Triggered ONLY when the user sends a task goal via the UI.
   */
  async function startAgent(prompt) {
    if (STATUS_META[currentStatus]?.working) return; // already working

    const tab = await resolveActiveTab();
    if (tab && isRestrictedUrl(tab.url)) {
      addMessage('agent', `PrivSight cannot run on internal browser URLs (${tab.url}). Please open a regular website first.`);
      return;
    }
    if (tab?.id) activeTabId = tab.id;

    // Immediately lock main browser interaction and engage Aurora overlay
    // Also hide the Gemini idle glow — restored after agent completes
    document.body.classList.add('agent-active');
    await lockPage();


    let currentDomain = 'Unknown';
    if (tab && tab.url) {
      try {
        currentDomain = new URL(tab.url).hostname || 'Unknown';
      } catch (_) {}
    }

    // 1. Generate unique session UUID
    currentSessionId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);

    if (typeof AgentSessionManager !== 'undefined') {
      activeSession = AgentSessionManager.createSession(prompt, {
        id: currentSessionId,
        tabId: activeTabId,
        domain: currentDomain,
      });
    }

    activeLoopAborted = false;
    isLoopPausedForUser = false;
    if (el.userPrompt) el.userPrompt.style.display = 'none';

    // Add user message to chat
    addMessage('user', prompt);

    // Reset stats
    stats = { dataFound: 0, sensitiveRecognized: 0, sensitiveRemoved: 0 };
    updatePrivacyStats(stats);

    // Start live agent backend loop
    runAgentLoop(prompt, currentSessionId, currentDomain);
  }

  /**
   * Autonomous loop driving POST /turn and action executions
   */
  async function runAgentLoop(taskGoal, sessionId, domain) {
    let turnCount = 0;
    let stepCount = 0;  // 0-indexed step counter sent in the snapshot
    let isComplete = false;
    let submittedGateKey = null;
    // Track the previous snapshot's elements so we can compute changed_since_last_step
    let prevElements = [];
    let lastElements = [];  // elements from the most recent snapshot (reused for screenshot calls)
    // Per-type redaction counts for the dashboard (keys match redactor.js stats)
    const breakdown = {};
    const startedAt = Date.now();

    updateAgentStatus('connecting');
    renderActivity('connecting', 'Connecting to agent...');

    try {
      // 1. Activate visual Aurora overlay
      await lockPage();
      sendSessionMessage({
        type: 'SESSION_START',
        sessionId,
        tabId: activeTabId,
        taskGoal,
        domain,
      });

      while (!isComplete && !activeLoopAborted) {
        if (turnCount >= MAX_SAFETY_TURNS) {
          addMessage('agent', `Safety limit reached (${MAX_SAFETY_TURNS} turns). Stopping automation to protect your session.`);
          break;
        }

        // ── STEP A: Capture sanitized DOM + redacted screenshot ──
        updateAgentStatus('reading_page');
        renderActivity('reading_page', `Step ${stepCount + 1}: Scrubbing DOM and capturing screenshot...`);

        const capturedState = await captureActiveTabState();
        if (activeLoopAborted) break;

        // Gate detection is local-only. Never send this page snapshot to the
        // backend until the user has completed and submitted the form.
        if (capturedState.human_gate && capturedState.human_gate_key !== submittedGateKey) {
          const humanChoice = await pauseForHumanInput(
            `This page needs your input (${capturedState.human_gate}). Enter it directly on the page, then submit or continue. PrivSight will resume after submission.`
          );
          if (humanChoice !== 'submitted' || activeLoopAborted) {
            // stopAgent() already cleaned up and reported if it set the abort flag.
            if (!activeLoopAborted) {
              await AgentBackendClient.deleteSession(sessionId);
              addMessage('agent', 'Task stopped by user.');
              activeLoopAborted = true;
              updateAgentStatus('idle');
            }
            break;
          }
          submittedGateKey = capturedState.human_gate_key;
          renderActivity('reading_page', 'Form submitted. Capturing a fresh sanitized page snapshot...');
          continue;
        }

        // Push real redaction stats from DOMRedactor to the UI
        if (capturedState.stats) {
          stats.dataFound += capturedState.stats.dataFound || 0;
          stats.sensitiveRecognized += capturedState.stats.sensitiveRecognized || 0;
          stats.sensitiveRemoved += capturedState.stats.sensitiveRemoved || 0;
          Object.entries(capturedState.stats.breakdown || {}).forEach(([k, v]) => {
            breakdown[k] = (breakdown[k] || 0) + (v || 0);
          });
          updatePrivacyStats(stats);
        }

        // ── Compute changed_since_last_step ──────────────────────────────
        // Compare current elements to the previous snapshot by mark_id.
        // An element is "changed" if its text, value, or redacted flag differs.
        const currentElements = capturedState.sanitized_dom || [];
        const changedSinceLastStep = [];
        if (prevElements.length > 0) {
          const prevMap = new Map(prevElements.map((e) => [e.mark_id, e]));
          currentElements.forEach((el) => {
            const prev = prevMap.get(el.mark_id);
            if (!prev ||
                prev.text !== el.text ||
                prev.value !== el.value ||
                prev.redacted !== el.redacted) {
              changedSinceLastStep.push(el.mark_id);
            }
          });
        }
        prevElements = currentElements;
        lastElements = currentElements;

        // ── STEP B: POST /task/start (first) or /task/step (subsequent) ──
        updateAgentStatus('planning');
        renderActivity('planning', `Step ${stepCount + 1}: Waiting for agent reasoning...`);

        const turnPayload = {
          sessionId,
          taskGoal: taskGoal,
          sanitizedDom: capturedState.sanitized_dom || [],
          sanitizedScreenshotB64: capturedState.sanitized_screenshot_b64 || '',
          step: stepCount,
          changedSinceLastStep,
          page: { url: capturedState.url, title: capturedState.title },
        };

        let turnResponse = await AgentBackendClient.postTurn(turnPayload);
        if (activeLoopAborted) break;

        // Screenshots and page text are sent only when requested, against the
        // same page state (and element numbering) as the turn that asked.
        let infoRequests = 0;
        while ((turnResponse.type === 'REQUEST_SCREENSHOT' || turnResponse.type === 'READ_PAGE') && !activeLoopAborted) {
          if (++infoRequests > 3) throw new Error('The agent requested too much extra information for the same page state.');
          if (turnResponse.type === 'READ_PAGE') {
            renderActivity('reading_page', 'Reading page text (PII scrubbed locally)...');
            const pageText = await readActiveTabText();
            turnResponse = await AgentBackendClient.postTaskPageText({ sessionId, pageText });
          } else {
            const screenshotB64 = capturedState.sanitized_screenshot_b64 || '';
            if (!screenshotB64) throw new Error('The agent requested a screenshot, but the page capture did not produce one.');
            turnResponse = await AgentBackendClient.postTaskScreenshot({
              sessionId,
              task: taskGoal,
              step: stepCount,
              elements: currentElements,
              screenshotB64,
              page: turnPayload.page,
            });
          }
        }
        if (activeLoopAborted) break;

        console.log(`[PrivSight Loop] Step ${stepCount + 1} response:`, turnResponse);

        // Record reasoning if provided
        if (turnResponse.reasoning) {
          renderActivity('planning', turnResponse.reasoning);
        }

        // Check completion / failure flags
        if (turnResponse.is_complete || turnResponse.type === 'DONE') {
          isComplete = true;
          const finalReply = turnResponse.text || turnResponse.summary || "Task completed successfully while keeping your sensitive data protected.";
          addMessage('agent', finalReply);
          updateAgentStatus('completed');
          renderActivity(null);
          break;
        }

        if (turnResponse.is_failed) {
          const failMsg = turnResponse.text || turnResponse.summary || 'The agent encountered an error completing the task.';
          addMessage('agent', `❌ ${failMsg}`);
          updateAgentStatus('error');
          renderActivity(null);
          break;
        }

        sendSessionMessage({
          type: 'SESSION_UPDATE',
          data: { stepIndex: turnCount + 1, currentAction: turnResponse },
        });

        // ── STEP C: Handle Action Type ──
        let execResult = null;
        switch (turnResponse.type) {
          case 'CLICK': {
            updateAgentStatus('executing');
            renderActivity('executing', `Clicking element [Hint: ${turnResponse.data_hint || 'N/A'}]...`);
            execResult = await executeTabAction(turnResponse);
            break;
          }

          case 'TYPE': {
            updateAgentStatus('executing');
            renderActivity('executing', `Typing into element [Hint: ${turnResponse.data_hint || 'N/A'}]...`);
            execResult = await executeTabAction(turnResponse);
            break;
          }

          case 'SCROLL': {
            updateAgentStatus('executing');
            renderActivity('executing', 'Scrolling page viewport...');
            execResult = await executeTabAction(turnResponse);
            break;
          }

          case 'NEW_TAB': {
            updateAgentStatus('executing');
            const targetDisplay = turnResponse.url || 'blank tab';
            renderActivity('executing', `Opening new tab: ${targetDisplay}...`);
            execResult = await executeNewTabAction(turnResponse);
            break;
          }

          case 'NAVIGATE': {
            updateAgentStatus('executing');
            renderActivity('executing', `Opening ${turnResponse.url || 'page'}...`);
            execResult = await executeNavigateAction(turnResponse);
            break;
          }

          case 'GO_BACK': {
            updateAgentStatus('executing');
            renderActivity('executing', 'Navigating back in tab history...');
            execResult = await executeGoBackAction();
            break;
          }

          case 'GO_FORWARD': {
            updateAgentStatus('executing');
            renderActivity('executing', 'Navigating forward in tab history...');
            execResult = await executeGoForwardAction();
            break;
          }

          case 'USER': {
            const promptText = turnResponse.text || 'The agent needs your input. Enter it directly on the page, then submit or continue.';
            addMessage('agent', 'Action required. Enter private information directly on the page; it will not be sent to the agent.');
            const userChoice = await pauseForHumanInput(`${promptText} Submit or continue on the page when finished. PrivSight will resume after submission.`);
            if (userChoice !== 'submitted' || activeLoopAborted) {
              // stopAgent() already cleaned up and reported if it set the abort flag.
              if (!activeLoopAborted) {
                await AgentBackendClient.deleteSession(sessionId);
                addMessage('agent', 'Task stopped by user.');
                activeLoopAborted = true;
                updateAgentStatus('idle');
              }
              break;
            }
            if (capturedState.human_gate) submittedGateKey = capturedState.human_gate_key;
            renderActivity('reading_page', 'Resuming agent loop with updated page state...');
            break;
          }

          default:
            console.warn(`[PrivSight Loop] Unknown action type: ${turnResponse.type}`);
        }

        if (execResult?.navigated) {
          renderActivity('reading_page', 'Page navigated. Continuing agent loop on new page...');
          await new Promise((r) => setTimeout(r, 600));
        }

        turnCount++;
        // The screenshot request was handled against this step's unchanged DOM;
        // the next loop captures and numbers a fresh page state.
        stepCount++;
        // Small delay to allow DOM render between turns
        await new Promise((r) => setTimeout(r, 600));
      }

      // Finalize stats
      stats.sensitiveRemoved = stats.sensitiveRecognized;
      updatePrivacyStats({ ...stats });

      // Clean up overlay and mark completed
      await unlockPage();
      sendSessionMessage({ type: 'SESSION_END' });

      if (isComplete) {
        updateAgentStatus('completed');
        // Persist session to local history
        await persistSession({
          id: Date.now(),
          timestamp: new Date().toISOString(),
          domain,
          prompt: taskGoal,
          dataFound: stats.dataFound,
          sensitiveRecognized: stats.sensitiveRecognized,
          sensitiveRemoved: stats.sensitiveRemoved,
          protectionRate: stats.sensitiveRecognized > 0
            ? Math.round((stats.sensitiveRemoved / stats.sensitiveRecognized) * 100)
            : 100,
          breakdown,
          steps: stepCount,
          durationMs: Date.now() - startedAt,
        });
      } else if (!activeLoopAborted) {
        updateAgentStatus('idle');
      }

    } catch (error) {
      if (isNavigationOrBfcacheError(error)) {
        console.debug('[PrivSight Loop] Navigation lifecycle transition handled smoothly.');
        return;
      }

      console.error('[PrivSight Loop] Execution failed:', error);
      const msg = error.message?.includes('Failed to fetch') || error.message?.includes('WebSocket')
        ? `Could not connect to backend at ${AgentBackendClient.WS_URL}. Please ensure the WebSocket backend server is running.`
        : `Agent error: ${error.message}`;

      addMessage('agent', `❌ ${msg}`);
      await unlockPage();
      updateAgentStatus('error');
      renderActivity(null);
    } finally {
      setTimeout(() => {
        if (currentStatus === 'completed' || currentStatus === 'error') {
          updateAgentStatus('idle');
        }
        // Restore Gemini idle glow once agent is done
        document.body.classList.remove('agent-active');
      }, 5000);
    }
  }

  /**
   * stopAgent()
   * Cancel an in-progress agent session and notify backend
   */
  async function stopAgent() {
    activeLoopAborted = true;
    sendSessionMessage({ type: 'SESSION_END' });
    if (userResumeResolver) {
      userResumeResolver('cancel');
      userResumeResolver = null;
    }

    if (currentSessionId) {
      AgentBackendClient.deleteSession(currentSessionId).catch(() => {});
      currentSessionId = null;
    }

    if (el.userPrompt) el.userPrompt.style.display = 'none';
    addMessage('agent', 'Task stopped by user.');
    await unlockPage();
    updateAgentStatus('idle');
    renderActivity(null);
    // Restore Gemini idle glow
    document.body.classList.remove('agent-active');
  }


  // ══════════════════════════════════════════════════════════════
  // UI HELPERS
  // ══════════════════════════════════════════════════════════════
  function updateAgentStatus(status) {
    currentStatus = status;
    const meta = STATUS_META[status] || STATUS_META['idle'];

    el.statusText.textContent = meta.label;
    el.statusDot.className = `ps-status-dot ${meta.dotClass}`;

    if (el.header) {
      el.header.className = `ps-toolbar ${meta.working ? 'working' : status === 'completed' ? 'completed' : ''}`;
    }

    el.logo.className = `ps-logo ${meta.working ? 'working' : ''}`;

    const isWorking = meta.working;
    el.input.disabled = isWorking;
    el.sendBtn.disabled = isWorking;

    if (el.privDot) el.privDot.className = `ps-priv-dot ${isWorking ? 'working' : ''}`;
    if (el.privacyBadgeTxt) el.privacyBadgeTxt.textContent = isWorking ? 'Working' : status === 'completed' ? 'Protected' : 'Protected';
  }

  function updatePrivacyStats(data) {
    if (el.statFound) animateNumber(el.statFound, stats.dataFound, data.dataFound);
    if (el.statRecognized) animateNumber(el.statRecognized, stats.sensitiveRecognized, data.sensitiveRecognized);
    if (el.statRemoved) animateNumber(el.statRemoved, stats.sensitiveRemoved, data.sensitiveRemoved);

    stats = { ...data };

    if (el.barFill) {
      const pct = data.sensitiveRecognized > 0
        ? (data.sensitiveRemoved / data.sensitiveRecognized) * 100
        : 100;
      el.barFill.style.width = `${Math.min(pct, 100)}%`;
      el.barFill.classList.toggle('partial', pct < 100 && pct > 0);
    }
  }

  function animateNumber(element, from, to) {
    if (!element || from === to) return;
    const duration = 500;
    const start = performance.now();

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(from + (to - from) * eased);
      element.textContent = value.toLocaleString();
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        element.textContent = to.toLocaleString();
      }
    }
    requestAnimationFrame(tick);
  }

  function addMessage(role, text) {
    const id = `msg-${Date.now()}`;
    messages.push({ id, role, text, ts: Date.now() });
    renderMessages();
  }

  function renderMessages() {
    el.idle.style.display = messages.length === 0 ? 'flex' : 'none';
    el.quickActions.classList.toggle('hidden', messages.length > 0);

    el.chat.querySelectorAll('.ps-msg').forEach((n) => n.remove());

    messages.forEach((msg) => {
      const div = document.createElement('div');
      div.className = `ps-msg ps-msg--${msg.role}`;
      div.id = msg.id;

      const bubble = document.createElement('div');
      bubble.className = 'ps-msg__bubble';
      bubble.textContent = msg.text;

      const meta = document.createElement('span');
      meta.className = 'ps-msg__meta';
      meta.textContent = msg.role === 'user' ? 'You' : 'PrivSight';

      div.appendChild(bubble);
      div.appendChild(meta);
      el.chat.appendChild(div);
    });

    el.chat.scrollTop = el.chat.scrollHeight;
  }

  function renderActivity(statusOrDone, customLabel) {
    if (!statusOrDone) {
      el.activity.classList.remove('visible');
      el.activitySteps.innerHTML = '';
      return;
    }

    el.activity.classList.add('visible');
    el.activitySteps.innerHTML = '';

    const li = document.createElement('li');
    li.className = 'ps-step ps-step--active';

    const icon = document.createElement('span');
    icon.className = 'ps-step__icon';
    icon.textContent = '◌';

    const label = document.createElement('span');
    label.textContent = customLabel || 'Working...';

    li.appendChild(icon);
    li.appendChild(label);
    el.activitySteps.appendChild(li);
  }

  async function persistSession(sessionData) {
    return new Promise((resolve) => {
      chrome.storage.local.get({ 'privsight-history': [] }, (result) => {
        const history = result['privsight-history'];
        history.push(sessionData);
        chrome.storage.local.set({ 'privsight-history': history }, resolve);
      });
    });
  }

  function openDashboard() {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  }

  // Opens the autofill profile, offering the ID/bank toggle for the current site.
  async function openProfile() {
    let site = '';
    try {
      const tab = await resolveActiveTab();
      const url = new URL(tab?.url || '');
      if (/^https?:$/.test(url.protocol)) site = url.origin;
    } catch (_) {}
    const query = site ? `?site=${encodeURIComponent(site)}` : '';
    chrome.tabs.create({ url: chrome.runtime.getURL(`profile/profile.html${query}`) });
  }

  // ══════════════════════════════════════════════════════════════
  // EVENT HANDLERS & INPUT AUTO-RESIZE
  // ══════════════════════════════════════════════════════════════
  function adjustInputHeight() {
    if (!el.input) return;
    el.input.style.height = 'auto';
    const singleLineH = 22;
    const maxH = 140;
    const scrollH = el.input.scrollHeight;
    const targetH = Math.min(Math.max(scrollH, singleLineH), maxH);
    el.input.style.height = `${targetH}px`;
    el.input.style.overflowY = scrollH > maxH ? 'auto' : 'hidden';
  }

  function handleSend() {
    const text = el.input.value.trim();
    if (!text) return;
    if (STATUS_META[currentStatus]?.working) return;

    el.input.value = '';
    adjustInputHeight();
    lockPage();
    startAgent(text);
  }

  function handleChipClick(e) {
    const chip = e.target.closest('.ps-chip');
    if (!chip) return;
    const prompt = chip.dataset.prompt;
    if (prompt && !STATUS_META[currentStatus]?.working) {
      el.input.value = prompt;
      adjustInputHeight();
      lockPage();
      startAgent(prompt);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ══════════════════════════════════════════════════════════════
  function init() {
    initTheme();

    el.dashboardBtn.addEventListener('click', openDashboard);
    if (el.profileBtn) el.profileBtn.addEventListener('click', openProfile);
    el.closeBtn.addEventListener('click', async () => {
      await stopAgent();
      window.close();
    });

    resolveActiveTab();

    chrome.tabs.onActivated.addListener(async (info) => {
      activeTabId = info.tabId;
    });

    chrome.tabs.onRemoved.addListener((closedTabId) => {
      if (activeTabId === closedTabId) {
        activeTabId = null;
      }
    });

    el.sendBtn.addEventListener('click', handleSend);
    el.input.addEventListener('input', adjustInputHeight);
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    el.quickActions.addEventListener('click', handleChipClick);

    // Human-in-the-loop Resume & Cancel buttons
    if (el.resumeBtn) {
      el.resumeBtn.addEventListener('click', () => {
        if (!userResumeResolver || el.resumeBtn.disabled) return;
        el.resumeBtn.disabled = true;
        el.resumeBtn.textContent = 'Waiting for page submission…';
        chrome.tabs.sendMessage(activeTabId, { type: 'ARM_HUMAN_SUBMIT' }, (response) => {
          if (chrome.runtime.lastError || !response?.ok) {
            if (el.resumeBtn) {
              el.resumeBtn.disabled = false;
              el.resumeBtn.textContent = 'Try again';
            }
            if (el.userPromptText) el.userPromptText.textContent = 'PrivSight could not detect the page form. Reload the page and try again, or stop this task.';
          }
        });
      });
    }

    if (el.cancelBtn) {
      el.cancelBtn.addEventListener('click', () => {
        if (userResumeResolver) {
          userResumeResolver('stop');
        }
      });
    }

    updateAgentStatus('idle');
    renderMessages();
    el.input.focus();
  }

  window.addEventListener('pagehide', () => {
    if (STATUS_META[currentStatus]?.working) {
      unlockPage();
    }
    if (currentSessionId) {
      AgentBackendClient.deleteSession(currentSessionId).catch(() => {});
    }
  });

  document.addEventListener('DOMContentLoaded', init);
})();
