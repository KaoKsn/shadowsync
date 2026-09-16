/**
 * PrivSight — Side Panel JavaScript (sidepanel.js)
 *
 * Drives the live privacy-preserving browser agent:
 *  1. Captures sanitized DOM + redacted screenshot (PII scrubbed, faces redacted, hint badges added)
 *  2. Dispatches turns to backend at http://localhost:8000 (POST /turn)
 *  3. Executes autonomous actions (CLICK, TYPE, SCROLL) in the live webpage
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
    user_action:        { label: 'Action Needed', dotClass: 'working', working: false },
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
    if (!url) return true;
    return (
      url.startsWith('chrome://') ||
      url.startsWith('brave://') ||
      url.startsWith('edge://') ||
      url.startsWith('about:') ||
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

  // ══════════════════════════════════════════════════════════════
  // OVERLAY CONTROLS
  // ══════════════════════════════════════════════════════════════
  async function lockPage() {
    let tab = activeTabId ? { id: activeTabId } : await resolveActiveTab();
    if (!tab?.id) tab = await resolveActiveTab();
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
            { target: { tabId: targetId }, files: ['content/agent.js'] },
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

  async function unlockPage() {
    sendSessionMessage({ type: 'AGENT_IDLE' });
    let targetId = activeTabId;
    if (!targetId) {
      const tab = await resolveActiveTab();
      targetId = tab?.id;
    }
    if (!targetId) return;
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(targetId, { type: 'STOP_AGENT', immediate: true }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }

  // ══════════════════════════════════════════════════════════════
  // AGENT EXECUTION LOOP (Backend Integration Guide)
  // ══════════════════════════════════════════════════════════════
  const MAX_SAFETY_TURNS = 25;

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
    let isComplete = false;

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
        renderActivity('reading_page', `Turn ${turnCount + 1}: Scrubbing DOM and capturing screenshot...`);

        const capturedState = await captureActiveTabState();
        if (activeLoopAborted) break;

        // Push real redaction stats from DOMRedactor to the UI
        if (capturedState.stats) {
          stats.dataFound += capturedState.stats.dataFound || 0;
          stats.sensitiveRecognized += capturedState.stats.sensitiveRecognized || 0;
          stats.sensitiveRemoved += capturedState.stats.sensitiveRemoved || 0;
          updatePrivacyStats(stats);
        }

        // ── STEP B: POST /turn to Backend ──
        updateAgentStatus('planning');
        renderActivity('planning', `Turn ${turnCount + 1}: Waiting for agent reasoning...`);

        const turnPayload = {
          sessionId,
          taskGoal: turnCount === 0 ? taskGoal : '', // only used on first turn
          sanitizedDom: capturedState.sanitized_dom || [],
          sanitizedScreenshotB64: capturedState.sanitized_screenshot_b64 || '',
        };

        const turnResponse = await AgentBackendClient.postTurn(turnPayload);
        if (activeLoopAborted) break;

        console.log(`[PrivSight Loop] Turn ${turnCount + 1} response:`, turnResponse);

        // Record reasoning if provided
        if (turnResponse.reasoning) {
          renderActivity('planning', turnResponse.reasoning);
        }

        // Check completion flag
        if (turnResponse.is_complete || turnResponse.type === 'DONE') {
          isComplete = true;
          const finalReply = turnResponse.text || "Task completed successfully while keeping your sensitive data protected.";
          addMessage('agent', finalReply);
          updateAgentStatus('completed');
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

          case 'USER': {
            // Pause loop, display instruction, wait for user confirmation
            updateAgentStatus('user_action');
            renderActivity(null);
            await setUserInteractiveMode(true);

            const promptText = turnResponse.text || 'Manual action required. Please perform the step on the page, then click Resume.';
            addMessage('agent', `⚠️ Action required: ${promptText}`);

            if (el.userPrompt && el.userPromptText) {
              el.userPromptText.textContent = promptText;
              el.userPrompt.style.display = 'block';
            }

            // Wait for user to click Resume or Cancel
            const userChoice = await new Promise((resolve) => {
              userResumeResolver = resolve;
            });

            if (el.userPrompt) el.userPrompt.style.display = 'none';
            await setUserInteractiveMode(false);

            if (userChoice === 'cancel' || activeLoopAborted) {
              await AgentBackendClient.deleteSession(sessionId);
              addMessage('agent', 'Task cancelled by user.');
              activeLoopAborted = true;
              break;
            }

            // User clicked resume: loop continues normally
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
      await unlockPage();
      updateAgentStatus('error');
      renderActivity(null);

      const msg = error.message?.includes('Failed to fetch')
        ? 'Could not connect to backend at http://localhost:8000. Please ensure the agent backend server is running and accessible.'
        : `Agent error: ${error.message}`;

      addMessage('agent', `❌ ${msg}`);
    } finally {
      setTimeout(() => {
        if (currentStatus === 'completed' || currentStatus === 'error') {
          updateAgentStatus('idle');
        }
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
    await unlockPage();
    updateAgentStatus('idle');
    renderActivity(null);
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

    el.privDot.className = `ps-priv-dot ${isWorking ? 'working' : ''}`;
    el.privacyBadgeTxt.textContent = isWorking ? 'Working' : status === 'completed' ? 'Protected' : 'Protected';
  }

  function updatePrivacyStats(data) {
    animateNumber(el.statFound, stats.dataFound, data.dataFound);
    animateNumber(el.statRecognized, stats.sensitiveRecognized, data.sensitiveRecognized);
    animateNumber(el.statRemoved, stats.sensitiveRemoved, data.sensitiveRemoved);

    stats = { ...data };

    const pct = data.sensitiveRecognized > 0
      ? (data.sensitiveRemoved / data.sensitiveRecognized) * 100
      : 100;
    el.barFill.style.width = `${Math.min(pct, 100)}%`;
    el.barFill.classList.toggle('partial', pct < 100 && pct > 0);
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

  // ══════════════════════════════════════════════════════════════
  // EVENT HANDLERS
  // ══════════════════════════════════════════════════════════════
  function handleSend() {
    const text = el.input.value.trim();
    if (!text) return;
    if (STATUS_META[currentStatus]?.working) return;

    el.input.value = '';
    startAgent(text);
  }

  function handleChipClick(e) {
    const chip = e.target.closest('.ps-chip');
    if (!chip) return;
    const prompt = chip.dataset.prompt;
    if (prompt && !STATUS_META[currentStatus]?.working) {
      el.input.value = prompt;
      startAgent(prompt);
    }
  }

  // ══════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ══════════════════════════════════════════════════════════════
  function init() {
    initTheme();

    el.dashboardBtn.addEventListener('click', openDashboard);
    el.closeBtn.addEventListener('click', async () => {
      await stopAgent();
      window.close();
    });

    resolveActiveTab();

    chrome.tabs.onActivated.addListener(async (info) => {
      activeTabId = info.tabId;
    });

    el.sendBtn.addEventListener('click', handleSend);
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
        if (userResumeResolver) {
          userResumeResolver('resume');
          userResumeResolver = null;
        }
      });
    }

    if (el.cancelBtn) {
      el.cancelBtn.addEventListener('click', () => {
        if (userResumeResolver) {
          userResumeResolver('cancel');
          userResumeResolver = null;
        }
      });
    }

    updateAgentStatus('idle');
    renderMessages();
    el.input.focus();
  }

  window.addEventListener('pagehide', () => {
    if (currentSessionId) {
      AgentBackendClient.deleteSession(currentSessionId).catch(() => {});
    }
  });

  document.addEventListener('DOMContentLoaded', init);
})();
