/**
 * PrivSight — Side Panel JavaScript (sidepanel.js)
 *
 * Architecture:
 *  - The side panel is the primary user interface.
 *  - It finds the active browser tab and injects/messages the content script.
 *  - All public-facing functions are clearly named so they can later be
 *    connected to a real AI backend with minimal refactoring.
 *
 * Public Interface (backend-ready):
 *  startAgent(prompt)         — Begin an agent session for the given prompt
 *  stopAgent()                — Cancel a running agent session
 *  updateAgentStatus(status)  — Update the current status stage
 *  updatePrivacyStats(data)   — Push new privacy stats to the UI
 *  lockPage()                 — Inject overlay + lock the current webpage
 *  unlockPage()               — Remove overlay, restore webpage interaction
 *  showAurora()               — Alias for lockPage (visual only in future)
 *  hideAurora()               — Alias for unlockPage (visual only in future)
 */

(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  // STATE
  // ══════════════════════════════════════════════════════════════
  let activeTabId = null;
  let sessionPort = null;

  try {
    sessionPort = chrome.runtime.connect({ name: 'privsight-sidepanel' });
  } catch (e) {
    console.debug('[PrivSight] Port connect:', e);
  }

  /**
   * currentStatus — tracks the agent's lifecycle stage.
   * Valid values: 'idle' | 'connecting' | 'reading_page' | 'protecting_data'
   *               'understanding_page' | 'planning' | 'executing'
   *               'completed' | 'error'
   */
  let currentStatus = 'idle';

  /** Chat message history */
  let messages = [];

  /** Privacy pipeline counters */
  let stats = {
    dataFound:           0,
    sensitiveRecognized: 0,
    sensitiveRemoved:    0,
  };

  /** Active simulation timers (so they can be cleared on stopAgent) */
  let timers = [];

  /** Active session managed by AgentSessionManager in localStorage */
  let activeSession = null;

  // ── Status metadata ─────────────────────────────────────────
  const STATUS_META = {
    idle:              { label: 'Ready',      dotClass: 'ready',     working: false },
    connecting:        { label: 'Connecting', dotClass: 'working',   working: true  },
    reading_page:      { label: 'Working',    dotClass: 'working',   working: true  },
    protecting_data:   { label: 'Working',    dotClass: 'working',   working: true  },
    understanding_page:{ label: 'Working',    dotClass: 'working',   working: true  },
    planning:          { label: 'Working',    dotClass: 'working',   working: true  },
    executing:         { label: 'Working',    dotClass: 'working',   working: true  },
    completed:         { label: 'Completed',  dotClass: 'completed', working: false },
    error:             { label: 'Error',      dotClass: 'error',     working: false },
  };

  // ── Agent activity steps (displayed in the side panel during work) ──
  const ACTIVITY_STEPS = [
    { id: 'connect',   label: 'Accessing page',              status: 'connecting'         },
    { id: 'read',      label: 'Reading page content',        status: 'reading_page'       },
    { id: 'protect',   label: 'Protecting sensitive data',   status: 'protecting_data'    },
    { id: 'understand',label: 'Understanding page context',  status: 'understanding_page' },
    { id: 'plan',      label: 'Planning action',             status: 'planning'           },
    { id: 'execute',   label: 'Executing task',              status: 'executing'          },
  ];



  // ── Simulated responses for demo mode ───────────────────────
  const MOCK_RESPONSES = [
    ['summarize',  'I\'ve read this page and here\'s a summary: The page contains structured information across several sections. Key data has been identified and protected before this analysis was performed.'],
    ['find',       'I\'ve scanned the page for the information you requested. Relevant elements were identified in the main content area. Your sensitive session data was kept protected throughout.'],
    ['fill',       'I\'ve identified the form fields on this page. I\'m ready to fill them securely — your personal data will be masked from any external services before submission.'],
    ['password',   'I noticed a password field on this page. PrivSight has masked this field from any AI analysis to ensure your credentials remain private.'],
    ['email',      'Email addresses detected on this page have been redacted from the AI\'s view. Your contact information is protected.'],
  ];

  // ══════════════════════════════════════════════════════════════
  // DOM REFERENCES
  // ══════════════════════════════════════════════════════════════
  const $ = (id) => document.getElementById(id);

  const el = {
    header:          $('ps-header'),
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
  };

  // ══════════════════════════════════════════════════════════════
  // THEME MANAGEMENT
  // ══════════════════════════════════════════════════════════════
  function initTheme() {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  // ══════════════════════════════════════════════════════════════
  // TAB RESOLUTION
  // ══════════════════════════════════════════════════════════════
  async function resolveActiveTab() {
    return new Promise((resolve) => {
      // 1. In Brave & Chrome side panels, the webpage tab belongs to lastFocusedWindow
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const valid = tabs?.find(t => t.id && !t.url?.startsWith('chrome-extension://'));
        if (valid) {
          activeTabId = valid.id;
          resolve(valid);
          return;
        }
        // 2. Fallback: currentWindow
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs2) => {
          const valid2 = tabs2?.find(t => t.id && !t.url?.startsWith('chrome-extension://'));
          if (valid2) {
            activeTabId = valid2.id;
            resolve(valid2);
            return;
          }
          // 3. Global fallback across all windows
          chrome.tabs.query({ active: true }, (tabs3) => {
            const valid3 = tabs3?.find(t => t.id && !t.url?.startsWith('chrome-extension://')) || tabs3?.[0];
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

  // ══════════════════════════════════════════════════════════════
  // PUBLIC INTERFACE — Backend-Ready Functions
  // ══════════════════════════════════════════════════════════════

  /**
   * startAgent(prompt)
   * Kick off an agent session for the given user prompt.
   * In production: call your backend API here and replace runSimulation().
   */
  async function startAgent(prompt) {
    if (STATUS_META[currentStatus]?.working) return; // already running

    const tab = await resolveActiveTab();
    let currentDomain = 'Unknown';
    if (tab && tab.url) {
      try {
        currentDomain = new URL(tab.url).hostname || 'Unknown';
      } catch (_) {}
    }

    // 1. Create unique agent session in localStorage
    if (typeof AgentSessionManager !== 'undefined') {
      activeSession = AgentSessionManager.createSession(prompt, {
        tabId: activeTabId,
        domain: currentDomain,
      });
    }

    // Add user message to chat
    addMessage('user', prompt);

    // Reset stats for fresh run
    stats = { dataFound: 0, sensitiveRecognized: 0, sensitiveRemoved: 0 };
    updatePrivacyStats(stats);

    // Lock the webpage and show Aurora
    await lockPage();

    // Run the agent execution sequence
    runSimulation(prompt);
  }

  /**
   * stopAgent()
   * Cancel an in-progress agent session.
   */
  async function stopAgent() {
    clearAllTimers();
    if (activeSession && typeof AgentSessionManager !== 'undefined') {
      AgentSessionManager.updateSession(activeSession.id, {
        status: AgentSessionManager.SessionStatus.STOPPED,
      });
      AgentSessionManager.appendActionToSession(activeSession.id, {
        type: 'user_stop',
        description: 'Agent session manually stopped by user.',
      });
      activeSession = null;
    }
    await unlockPage();
    updateAgentStatus('idle');
    renderActivity(null);
  }

  /**
   * updateAgentStatus(status)
   * Update the displayed status stage.
   * In production: call this whenever the backend sends a status event.
   * @param {string} status — one of the keys in STATUS_META
   */
  function updateAgentStatus(status) {
    currentStatus = status;
    const meta = STATUS_META[status] || STATUS_META['idle'];

    // Header
    el.statusText.textContent = meta.label;
    el.statusDot.className    = `ps-status-dot ${meta.dotClass}`;

    // Header working accent line (guard: ps-header may not exist)
    if (el.header) el.header.className = `ps-header ${meta.working ? 'working' : status === 'completed' ? 'completed' : ''}`;

    // Logo pulse
    el.logo.className   = `ps-logo ${meta.working ? 'working' : ''}`;

    // Input state
    el.input.disabled      = meta.working;
    el.sendBtn.disabled    = meta.working;

    // Privacy dot
    el.privDot.className   = `ps-priv-dot ${meta.working ? 'working' : ''}`;
    el.privacyBadgeTxt.textContent = meta.working ? 'Working' : status === 'completed' ? 'Protected' : 'Protected';
  }

  /**
   * updatePrivacyStats(data)
   * Push new privacy stats to the UI with animated number transitions.
   * In production: call this whenever the backend sends updated counts.
   * @param {{ dataFound: number, sensitiveRecognized: number, sensitiveRemoved: number }} data
   */
  function updatePrivacyStats(data) {
    animateNumber(el.statFound,       stats.dataFound,           data.dataFound);
    animateNumber(el.statRecognized,  stats.sensitiveRecognized, data.sensitiveRecognized);
    animateNumber(el.statRemoved,     stats.sensitiveRemoved,    data.sensitiveRemoved);

    stats = { ...data };

    // Update protection bar
    const pct = data.sensitiveRecognized > 0
      ? (data.sensitiveRemoved / data.sensitiveRecognized) * 100
      : 0;
    el.barFill.style.width = `${Math.min(pct, 100)}%`;
    el.barFill.classList.toggle('partial', pct < 100 && pct > 0);
  }

  /**
   * lockPage()
   * Inject agent.js into the current tab and send START_AGENT.
   * This creates the Aurora overlay and blocks page interaction.
   * In production: also pass sanitized context to the backend.
   */
  async function lockPage() {
    let tab = activeTabId ? { id: activeTabId } : await resolveActiveTab();
    if (!tab?.id) {
      tab = await resolveActiveTab();
    }
    if (!tab?.id) {
      console.warn('[PrivSight] Cannot lock page: no active tab found.');
      return;
    }
    activeTabId = tab.id;
    const targetId = activeTabId;

    if (tab.url && (
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('brave://') ||
      tab.url.startsWith('edge://') ||
      tab.url.startsWith('about:') ||
      tab.url.startsWith('chrome-extension://')
    )) {
      console.info('[PrivSight] Cannot inject into internal browser page:', tab.url);
      return;
    }

    return new Promise((resolve) => {
      // Step A: Attempt direct message (works if agent.js is already running via content_scripts)
      chrome.tabs.sendMessage(targetId, { type: 'START_AGENT' }, (response) => {
        if (!chrome.runtime.lastError && response?.ok) {
          if (sessionPort) {
            sessionPort.postMessage({ type: 'AGENT_WORKING', tabId: targetId });
          }
          resolve();
          return;
        }

        // Step B: If not listening yet, dynamically inject agent.js then send START_AGENT
        if (chrome?.scripting?.executeScript) {
          chrome.scripting.executeScript(
            { target: { tabId: targetId }, files: ['content/agent.js'] },
            () => {
              if (chrome.runtime.lastError) {
                console.warn('[PrivSight] Script inject note:', chrome.runtime.lastError.message);
              }
              // Always attempt to send message after injection
              chrome.tabs.sendMessage(targetId, { type: 'START_AGENT' }, () => {
                if (chrome.runtime.lastError) {
                  console.debug('[PrivSight] START_AGENT retry:', chrome.runtime.lastError.message);
                }
                if (sessionPort) {
                  sessionPort.postMessage({ type: 'AGENT_WORKING', tabId: targetId });
                }
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

  /**
   * unlockPage()
   * Send STOP_AGENT to the content script, removing the Aurora overlay
   * and restoring normal page interaction.
   */
  async function unlockPage() {
    if (sessionPort) {
      sessionPort.postMessage({ type: 'AGENT_IDLE' });
    }
    let targetId = activeTabId;
    if (!targetId) {
      const tab = await resolveActiveTab();
      targetId = tab?.id;
    }
    if (!targetId) return;
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(targetId, { type: 'STOP_AGENT', immediate: true }, () => {
        if (chrome.runtime.lastError) {
          console.debug('[PrivSight] STOP_AGENT:', chrome.runtime.lastError.message);
        }
        resolve();
      });
    });
  }

  // ══════════════════════════════════════════════════════════════
  // SESSION PERSISTENCE — saves completed sessions to chrome.storage
  // ══════════════════════════════════════════════════════════════

  /**
   * persistSession(sessionData)
   * Appends a session record to chrome.storage.local under 'privsight-history'.
   * The dashboard reads this key to show all-time analytics.
   */
  async function persistSession(sessionData) {
    return new Promise((resolve) => {
      chrome.storage.local.get({ 'privsight-history': [] }, (result) => {
        const history = result['privsight-history'];
        history.push(sessionData);
        chrome.storage.local.set({ 'privsight-history': history }, resolve);
      });
    });
  }

  /**
   * openDashboard()
   * Opens the analytics dashboard in a new browser tab.
   */
  function openDashboard() {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  }

  /** showAurora — visual alias for lockPage (ready for visual-only separation) */
  async function showAurora() { return lockPage(); }

  /** hideAurora — visual alias for unlockPage */
  async function hideAurora() { return unlockPage(); }

  // ══════════════════════════════════════════════════════════════
  // SIMULATION ENGINE
  // Sequential async pipeline — each stage waits for the previous.
  // GUARANTEED ORDER:
  //   1. Aurora appears (lockPage done before runSimulation is called)
  //   2. Checklist steps tick through one by one while aurora stays
  //   3. All steps complete → reply is added to chat
  //   4. Aurora closes AFTER reply is visible
  //   5. Status → completed, then idle after 4s
  // ══════════════════════════════════════════════════════════════


  async function runSimulation(prompt) {
    const cancel = { cancelled: false };

    const sequence = [
      { status: 'connecting',         duration: 1600 },
      { status: 'reading_page',       duration: 1800 },
      { status: 'protecting_data',    duration: 2000 },
      { status: 'understanding_page', duration: 1800 },
      { status: 'planning',           duration: 1600 },
      { status: 'executing',          duration: 2200 },
    ];

    const statIncrements = [
      { dataFound: 412,  sensitiveRecognized: 0,  sensitiveRemoved: 0  },
      { dataFound: 938,  sensitiveRecognized: 0,  sensitiveRemoved: 0  },
      { dataFound: 0,    sensitiveRecognized: 31, sensitiveRemoved: 31 },
      { dataFound: 518,  sensitiveRecognized: 14, sensitiveRemoved: 14 },
      { dataFound: 193,  sensitiveRecognized: 8,  sensitiveRemoved: 8  },
      { dataFound: 0,    sensitiveRecognized: 0,  sensitiveRemoved: 0  },
    ];

    // ── PHASE 1: Step through the checklist ───────────────
    // Aurora is already live. Each step waits its full duration
    // before the next one begins — no overlapping timeouts.
    for (let i = 0; i < sequence.length; i++) {
      if (cancel.cancelled) return;

      const { status, duration } = sequence[i];
      updateAgentStatus(status);
      renderActivity(status);

      const inc = statIncrements[i];
      updatePrivacyStats({
        dataFound:           stats.dataFound           + inc.dataFound,
        sensitiveRecognized: stats.sensitiveRecognized + inc.sensitiveRecognized,
        sensitiveRemoved:    stats.sensitiveRemoved    + inc.sensitiveRemoved,
      });

      // Trigger agent action / call backend placeholder & update localStorage session
      if (activeSession && typeof AgentSessionManager !== 'undefined') {
        try {
          const agentAction = await AgentSessionManager.fetchAgentAction(activeSession, i, {
            stats: { ...stats },
          });

          // Store agent action in session and update localStorage
          AgentSessionManager.appendActionToSession(activeSession.id, {
            stepIndex: i,
            action: agentAction.action,
            status: status,
            description: agentAction.description,
            stats: { ...stats },
          });

          // Update session status in localStorage
          AgentSessionManager.updateSession(activeSession.id, {
            status: status,
          });
        } catch (err) {
          console.warn('[PrivSight Session] Action fetch notice:', err);
        }
      }

      // Wait for this step to complete before advancing
      await new Promise((resolve) => {
        const t = setTimeout(resolve, duration);
        timers.push(t);
      });
    }

    if (cancel.cancelled) return;

    // ── PHASE 2: Pause so user sees "Executing" finish ────
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 1200);
      timers.push(t);
    });

    if (cancel.cancelled) return;

    // ── PHASE 3: Finalize stats ───────────────────────────
    stats.sensitiveRemoved = stats.sensitiveRecognized;
    updatePrivacyStats({ ...stats });

    // ── PHASE 4: Show the reply (aurora still active) ─────
    const lower = prompt.toLowerCase();
    const match = MOCK_RESPONSES.find(([k]) => lower.includes(k));
    const reply = match
      ? match[1]
      : "Done. I've completed the task on this page while keeping your sensitive information protected throughout.";

    addMessage('agent', reply);
    updateAgentStatus('completed');
    renderActivity(null);

    // Record completed state & reply action in session localStorage
    if (activeSession && typeof AgentSessionManager !== 'undefined') {
      AgentSessionManager.appendActionToSession(activeSession.id, {
        type: 'agent_response',
        reply: reply,
        isFinal: true,
        stats: { ...stats },
      });
      AgentSessionManager.updateSession(activeSession.id, {
        status: AgentSessionManager.SessionStatus.COMPLETED,
      });
      activeSession = null;
    }

    // ── PHASE 5: Close aurora AFTER reply is visible ──────
    await unlockPage();

    // ── PHASE 6: Persist to Dashboard storage ────────────
    let domain = 'Unknown';
    try {
      const tab = await resolveActiveTab();
      if (tab && tab.url) {
        domain = new URL(tab.url).hostname || 'Unknown';
      }
    } catch (_) {}

    const totalSensitive = stats.sensitiveRecognized;
    const breakdown = {
      email:      Math.round(totalSensitive * 0.35),
      phone:      Math.round(totalSensitive * 0.20),
      creditCard: Math.round(totalSensitive * 0.15),
      ssn:        Math.round(totalSensitive * 0.10),
      password:   Math.round(totalSensitive * 0.12),
      other:      totalSensitive - Math.round(totalSensitive * 0.92),
    };

    await persistSession({
      id:                  Date.now(),
      timestamp:           new Date().toISOString(),
      domain,
      prompt,
      dataFound:           stats.dataFound,
      sensitiveRecognized: stats.sensitiveRecognized,
      sensitiveRemoved:    stats.sensitiveRemoved,
      protectionRate:      stats.sensitiveRecognized > 0
                             ? Math.round((stats.sensitiveRemoved / stats.sensitiveRecognized) * 100)
                             : 100,
      breakdown,
    });

    // ── PHASE 7: Return to idle ───────────────────────────
    const idleT = setTimeout(() => updateAgentStatus('idle'), 4000);
    timers.push(idleT);
  }



  // ══════════════════════════════════════════════════════════════
  // UI RENDERING
  // ══════════════════════════════════════════════════════════════

  /** Add a message to the chat and scroll to bottom */
  function addMessage(role, text) {
    const id = `msg-${Date.now()}`;
    messages.push({ id, role, text, ts: Date.now() });
    renderMessages();
  }

  /** Re-render all chat messages */
  function renderMessages() {
    // Hide idle placeholder if there are messages
    el.idle.style.display = messages.length === 0 ? 'flex' : 'none';
    el.quickActions.classList.toggle('hidden', messages.length > 0);

    // Remove old message nodes (keep idle node)
    el.chat.querySelectorAll('.ps-msg').forEach(n => n.remove());

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

    // Scroll to bottom
    el.chat.scrollTop = el.chat.scrollHeight;
  }

  /**
   * renderActivity(activeStatus)
   * Show/hide and update the agent activity log.
   * Pass null to hide the log.
   */
  function renderActivity(activeStatus) {
    if (!activeStatus) {
      el.activity.classList.remove('visible');
      el.activitySteps.innerHTML = '';
      return;
    }

    el.activity.classList.add('visible');
    el.activitySteps.innerHTML = '';

    const activeIndex = ACTIVITY_STEPS.findIndex(s => s.status === activeStatus);

    ACTIVITY_STEPS.forEach((step, i) => {
      if (i > activeIndex) return; // don't show future steps

      const li = document.createElement('li');
      const isDone   = i < activeIndex;
      const isActive = i === activeIndex;

      li.className = `ps-step ${isDone ? 'ps-step--done' : isActive ? 'ps-step--active' : ''}`;

      const icon = document.createElement('span');
      icon.className = 'ps-step__icon';
      icon.textContent = isDone ? '✓' : '◌';

      const label = document.createElement('span');
      label.textContent = step.label;

      li.appendChild(icon);
      li.appendChild(label);
      el.activitySteps.appendChild(li);
    });
  }

  /** Clear all running simulation timers */
  function clearAllTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  // ══════════════════════════════════════════════════════════════
  // NUMBER ANIMATION
  // ══════════════════════════════════════════════════════════════
  function animateNumber(element, from, to) {
    if (from === to) return;
    const duration = 700;
    const start    = performance.now();
    element.classList.add('animating');

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // cubic ease-out
      const value = Math.round(from + (to - from) * eased);
      element.textContent = value.toLocaleString();
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        element.textContent = to.toLocaleString();
        element.classList.remove('animating');
      }
    }
    requestAnimationFrame(tick);
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
  // INITIALISATION
  // ══════════════════════════════════════════════════════════════
  function init() {
    // Session recovery on reload
    if (typeof AgentSessionManager !== 'undefined') {
      AgentSessionManager.handlePageRefreshRecovery();
    }

    // Theme
    initTheme();

    // Dashboard button
    el.dashboardBtn.addEventListener('click', openDashboard);

    // Close panel
    el.closeBtn.addEventListener('click', async () => {
      await stopAgent();
      window.close();
    });

    // Find the active tab right away
    resolveActiveTab();

    // Track tab changes (side panel persists across navigations)
    chrome.tabs.onActivated.addListener(async (info) => {
      activeTabId = info.tabId;
    });

    // Input events
    el.sendBtn.addEventListener('click', handleSend);
    el.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Quick action chips
    el.quickActions.addEventListener('click', handleChipClick);

    // Set initial UI state
    updateAgentStatus('idle');
    renderMessages();

    el.input.focus();
  }

  // Cleanup on unload / close
  function handlePanelClose() {
    clearAllTimers();
    if (activeTabId && chrome?.tabs?.sendMessage) {
      chrome.tabs.sendMessage(activeTabId, { type: 'STOP_AGENT', immediate: true }, () => {
        void chrome.runtime.lastError;
      });
    }
  }

  window.addEventListener('pagehide', handlePanelClose);
  window.addEventListener('beforeunload', handlePanelClose);
  window.addEventListener('unload', handlePanelClose);

  // Boot
  document.addEventListener('DOMContentLoaded', init);

})();
