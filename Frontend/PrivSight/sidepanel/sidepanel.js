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

  // ── Simulation timing (ms) — replace with real backend events later ──
  // Total ~10 seconds: [0, 2s, 4s, 6s, 8s, 9s, done at ~10s]
  const SIMULATION_DELAYS = [0, 2000, 4000, 6000, 8000, 9000];

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
    themeToggle:     $('ps-theme-toggle'),
    closeBtn:        $('ps-close-btn'),
    iconMoon:        $('ps-icon-moon'),
    iconSun:         $('ps-icon-sun'),
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
    const saved = localStorage.getItem('privsight-theme') || 'dark';
    applyTheme(saved);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    el.iconMoon.style.display = theme === 'dark'  ? 'block' : 'none';
    el.iconSun.style.display  = theme === 'light' ? 'block' : 'none';
    localStorage.setItem('privsight-theme', theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  // ══════════════════════════════════════════════════════════════
  // TAB RESOLUTION
  // ══════════════════════════════════════════════════════════════
  async function resolveActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs.length > 0) {
          activeTabId = tabs[0].id;
          resolve(tabs[0]);
        } else {
          resolve(null);
        }
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

    await resolveActiveTab();

    // Add user message to chat
    addMessage('user', prompt);

    // Reset stats for fresh run
    stats = { dataFound: 0, sensitiveRecognized: 0, sensitiveRemoved: 0 };
    updatePrivacyStats(stats);

    // Lock the webpage and show Aurora
    await lockPage();

    // Run the simulation sequence
    // TODO: Replace runSimulation() with real backend event stream
    runSimulation(prompt);
  }

  /**
   * stopAgent()
   * Cancel an in-progress agent session.
   */
  async function stopAgent() {
    clearAllTimers();
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

    // Header working accent line
    el.header.className = `ps-header ${meta.working ? 'working' : status === 'completed' ? 'completed' : ''}`;

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
    if (!activeTabId) return;
    return new Promise((resolve) => {
      chrome.scripting.executeScript(
        { target: { tabId: activeTabId }, files: ['content/agent.js'] },
        () => {
          if (chrome.runtime.lastError) {
            console.warn('[PrivSight] Inject failed:', chrome.runtime.lastError.message);
            resolve();
            return;
          }
          chrome.tabs.sendMessage(activeTabId, { type: 'START_AGENT' }, () => {
            if (chrome.runtime.lastError) {
              console.debug('[PrivSight] START_AGENT:', chrome.runtime.lastError.message);
            }
            resolve();
          });
        }
      );
    });
  }

  /**
   * unlockPage()
   * Send STOP_AGENT to the content script, removing the Aurora overlay
   * and restoring normal page interaction.
   */
  async function unlockPage() {
    if (!activeTabId) return;
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(activeTabId, { type: 'STOP_AGENT' }, () => {
        if (chrome.runtime.lastError) {
          console.debug('[PrivSight] STOP_AGENT:', chrome.runtime.lastError.message);
        }
        resolve();
      });
    });
  }

  /** showAurora — visual alias for lockPage (ready for visual-only separation) */
  async function showAurora() { return lockPage(); }

  /** hideAurora — visual alias for unlockPage */
  async function hideAurora() { return unlockPage(); }

  // ══════════════════════════════════════════════════════════════
  // SIMULATION ENGINE
  // Replace this entire function with real backend integration.
  // The function signature and the calls it makes to the public
  // interface above should remain identical.
  // ══════════════════════════════════════════════════════════════
  function runSimulation(prompt) {
    const sequence = [
      'connecting', 'reading_page', 'protecting_data',
      'understanding_page', 'planning', 'executing',
    ];

    // Stat increments per stage
    const statIncrements = [
      { dataFound: 412,  sensitiveRecognized: 0,  sensitiveRemoved: 0  },
      { dataFound: 938,  sensitiveRecognized: 0,  sensitiveRemoved: 0  },
      { dataFound: 0,    sensitiveRecognized: 31, sensitiveRemoved: 31 },
      { dataFound: 518,  sensitiveRecognized: 14, sensitiveRemoved: 14 },
      { dataFound: 193,  sensitiveRecognized: 8,  sensitiveRemoved: 8  },
      { dataFound: 0,    sensitiveRecognized: 0,  sensitiveRemoved: 0  },
    ];

    // Show activity log
    renderActivity(sequence[0]);

    sequence.forEach((status, i) => {
      const t = setTimeout(() => {
        updateAgentStatus(status);
        renderActivity(status);

        // Accumulate stats
        const inc = statIncrements[i];
        updatePrivacyStats({
          dataFound:           stats.dataFound           + inc.dataFound,
          sensitiveRecognized: stats.sensitiveRecognized + inc.sensitiveRecognized,
          sensitiveRemoved:    stats.sensitiveRemoved    + inc.sensitiveRemoved,
        });
      }, SIMULATION_DELAYS[i]);
      timers.push(t);
    });

    // Completion — ~10 seconds total
    const doneT = setTimeout(() => {
      stats.sensitiveRemoved = stats.sensitiveRecognized;
      updatePrivacyStats({ ...stats });

      // Find a matching mock response
      const lower = prompt.toLowerCase();
      const match = MOCK_RESPONSES.find(([k]) => lower.includes(k));
      const reply = match
        ? match[1]
        : 'Done. I\'ve completed the task on this page while keeping your sensitive information protected throughout.';

      addMessage('agent', reply);
      updateAgentStatus('completed');
      renderActivity(null); // hide activity log

      // Unlock the page
      unlockPage();

      // Return to idle after 4 seconds
      const idleT = setTimeout(() => {
        updateAgentStatus('idle');
      }, 4000);
      timers.push(idleT);
    }, SIMULATION_DELAYS[sequence.length - 1] + 1200);
    timers.push(doneT);
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
    // Theme
    initTheme();
    el.themeToggle.addEventListener('click', toggleTheme);

    // Close panel
    el.closeBtn.addEventListener('click', () => window.close());

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

  // Boot
  document.addEventListener('DOMContentLoaded', init);

})();
