/**
 * PrivSight Popup Script
 * State machine, message bus communication, dynamic rendering, and Figma UI interactions
 */

// ─────────────────────────────────────────────────────────
// Configuration & Data Structures
// ─────────────────────────────────────────────────────────

const AGENT_CONFIGS = {
  connecting: {
    message: 'Connecting to PrivSight',
    detail: 'Establishing a secure connection to the agent...',
    progress: 8,
    steps: [
      { id: 'connect', label: 'Connecting', status: 'active' },
      { id: 'page', label: 'Page accessed', status: 'pending' },
      { id: 'protect', label: 'Sensitive information protected', status: 'pending' },
      { id: 'identify', label: 'Identifying elements', status: 'pending' },
    ],
  },
  reading_page: {
    message: 'Reading this page',
    detail: 'Accessing the current page content...',
    progress: 22,
    steps: [
      { id: 'connect', label: 'Connected', status: 'done' },
      { id: 'page', label: 'Page accessed', status: 'active' },
      { id: 'protect', label: 'Sensitive information protected', status: 'pending' },
      { id: 'identify', label: 'Identifying elements', status: 'pending' },
    ],
  },
  protecting_data: {
    message: 'Protecting your data',
    detail: 'Sanitizing sensitive information before processing...',
    progress: 42,
    steps: [
      { id: 'page', label: 'Page accessed', status: 'done' },
      { id: 'protect', label: 'Sensitive information protected', status: 'active' },
      { id: 'identify', label: 'Identifying elements', status: 'pending' },
    ],
  },
  understanding_page: {
    message: 'Working on this page',
    detail: 'Understanding the current webpage...',
    progress: 58,
    steps: [
      { id: 'page', label: 'Page accessed', status: 'done' },
      { id: 'protect', label: 'Sensitive information protected', status: 'done' },
      { id: 'identify', label: 'Identifying elements', status: 'active' },
    ],
  },
  planning_action: {
    message: 'Working on this page',
    detail: 'Planning the next action...',
    progress: 72,
    steps: [
      { id: 'page', label: 'Page accessed', status: 'done' },
      { id: 'protect', label: 'Sensitive information protected', status: 'done' },
      { id: 'identify', label: 'Identifying elements', status: 'done' },
      { id: 'plan', label: 'Planning action', status: 'active' },
    ],
  },
  executing: {
    message: 'Working on this page',
    detail: 'Executing the requested task...',
    progress: 88,
    steps: [
      { id: 'page', label: 'Page accessed', status: 'done' },
      { id: 'protect', label: 'Sensitive information protected', status: 'done' },
      { id: 'identify', label: 'Identifying elements', status: 'done' },
      { id: 'plan', label: 'Planning action', status: 'done' },
      { id: 'execute', label: 'Executing task', status: 'active' },
    ],
  },
};

const STATUS_META = {
  idle: { label: 'Ready', color: 'var(--green)', working: false },
  connecting: { label: 'Connecting', color: 'var(--amber)', working: true },
  reading_page: { label: 'Reading page', color: 'var(--accent)', working: true },
  protecting_data: { label: 'Protecting data', color: 'var(--accent)', working: true },
  understanding_page: { label: 'Working', color: 'var(--accent)', working: true },
  planning_action: { label: 'Planning', color: 'var(--accent)', working: true },
  executing: { label: 'Executing', color: 'var(--accent)', working: true },
  completed: { label: 'Completed', color: 'var(--green)', working: false },
  error: { label: 'Error', color: 'var(--red)', working: false },
  page_unavailable: { label: 'Unavailable', color: 'var(--text-3)', working: false },
};

const WORKING_SEQUENCE = [
  'connecting',
  'reading_page',
  'protecting_data',
  'understanding_page',
  'planning_action',
  'executing',
];

const MOCK_RESPONSES = [
  ['find', 'I can search the page for you. What are you looking for?'],
  ['fill', 'I can see a form on this page. What information should I use to fill it in?'],
  ['summarize', 'This page is a product landing page for a developer tool. Key points: self-hostable, starts at $12/mo, API access on all plans. Three pricing tiers. Privacy policy linked in the footer.'],
];

const DEFAULT_STATS = {
  dataFound: 2061,
  sensitiveRecognized: 53,
  sensitiveRemoved: 53,
};

// ─────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────

let currentStatus = 'idle';
let messages = [];
let stats = { ...DEFAULT_STATS };
let timers = [];
let activeTabId = null;
let isUnavailable = false;

// ─────────────────────────────────────────────────────────
// DOM Elements
// ─────────────────────────────────────────────────────────

const auroraLine = document.getElementById('aurora-line');
const statusDot = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');
const activeNotice = document.getElementById('active-notice');
const chatContainer = document.getElementById('chat-container');
const emptyState = document.getElementById('empty-state');
const unavailableState = document.getElementById('unavailable-state');
const messagesList = document.getElementById('messages-list');
const workingPanel = document.getElementById('working-panel');
const workingTitle = document.getElementById('working-title');
const workingDetail = document.getElementById('working-detail');
const workingSteps = document.getElementById('working-steps');
const quickActions = document.getElementById('quick-actions');
const inputSection = document.getElementById('input-section');
const promptInput = document.getElementById('prompt');
const sendBtn = document.getElementById('send');
const scrollAnchor = document.getElementById('scroll-anchor');

// Privacy Stats DOM (Flow: Data found -> Sensitive recognized -> Sensitive removed)
const privacyStatusBadge = document.getElementById('privacy-status-badge');
const privacyBadgeDot = document.getElementById('privacy-badge-dot');
const privacyBadgeText = document.getElementById('privacy-badge-text');
const privacyProgressBar = document.getElementById('privacy-progress-bar');
const progressScan = document.getElementById('progress-scan');
const statDataFound = document.getElementById('stat-data-found');
const statSensitiveRecognized = document.getElementById('stat-sensitive-recognized');
const statSensitiveRemoved = document.getElementById('stat-sensitive-removed');
const privacySummaryPercent = document.getElementById('privacy-summary-percent');

// Settings DOM
const settingsBtn = document.getElementById('settings-btn');
const settingsDrawer = document.getElementById('settings-drawer');
const closeSettingsBtn = document.getElementById('close-settings-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const openTabBtn = document.getElementById('open-tab-btn');
const closeBtn = document.getElementById('close-btn');
const dashboardBtn = document.getElementById('dashboard-btn');

// ─────────────────────────────────────────────────────────
// SVG Helper Functions
// ─────────────────────────────────────────────────────────

function getCheckIconSvg() {
  return `<svg width="11" height="11" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="M2 5.5 4.25 7.75 8.5 3" stroke="var(--green)" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`;
}

function getAlertIconSvg() {
  return `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M6 1 1 11h10L6 1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
    <path d="M6 4.5v3M6 9h.01" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
  </svg>`;
}

function getAgentAvatarSvg() {
  return `<div class="agent-avatar">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3.5 20V6C3.5 3.2 6.8 2.5 13.5 2.5L15 3.8L13 7.8"/>
      <path d="M3.5 15.5L7 18L3.5 20"/>
      <path d="M7 12.5C9 8.2 14 7.2 21 12.5C14 17.8 9 16.8 7 12.5Z"/>
      <circle cx="13.5" cy="12.5" r="3"/>
      <line x1="10.5" y1="18.5" x2="16" y2="6.5"/>
    </svg>
  </div>`;
}

// ─────────────────────────────────────────────────────────
// Render Functions
// ─────────────────────────────────────────────────────────

function updateUI() {
  const meta = STATUS_META[currentStatus] || STATUS_META.idle;
  const isWorking = meta.working;
  const hasMessages = messages.length > 0;

  // 1. Header status
  statusLabel.textContent = meta.label;
  statusDot.style.background = meta.color;
  if (isWorking) {
    statusDot.className = 'status-dot-working';
    auroraLine.classList.add('active');
    activeNotice.classList.remove('hidden');
  } else {
    statusDot.className = 'status-dot';
    auroraLine.classList.remove('active');
    activeNotice.classList.add('hidden');
  }

  // 2. State Visibility
  if (isUnavailable) {
    emptyState.classList.add('hidden');
    quickActions.classList.add('hidden');
    unavailableState.classList.remove('hidden');
    workingPanel.classList.add('hidden');
    inputSection.classList.add('hidden');
  } else {
    unavailableState.classList.add('hidden');
    inputSection.classList.remove('hidden');

    if (!hasMessages && !isWorking) {
      emptyState.classList.remove('hidden');
      quickActions.classList.remove('hidden');
    } else {
      emptyState.classList.add('hidden');
      quickActions.classList.add('hidden');
    }
  }

  // 3. Input borders & states
  if (hasMessages || isWorking) {
    inputSection.classList.add('bordered');
  } else {
    inputSection.classList.remove('bordered');
  }

  promptInput.disabled = isWorking || isUnavailable;
  const canSend = promptInput.value.trim().length > 0 && !isWorking && !isUnavailable;
  sendBtn.disabled = !canSend;

  // 4. Working Steps Panel
  if (isWorking && AGENT_CONFIGS[currentStatus]) {
    const config = AGENT_CONFIGS[currentStatus];
    workingPanel.classList.remove('hidden');
    workingTitle.textContent = config.message;
    workingDetail.textContent = config.detail;

    workingSteps.innerHTML = config.steps
      .map((step) => {
        let indicatorHtml = '';
        if (step.status === 'done') {
          indicatorHtml = getCheckIconSvg();
        } else if (step.status === 'active') {
          indicatorHtml = '<span class="step-ring-dot"></span>';
        } else {
          indicatorHtml = '<span class="step-pending-dot"></span>';
        }

        return `
        <div class="step-row ${step.status}">
          <div class="step-indicator">${indicatorHtml}</div>
          <span class="step-label">${step.label}</span>
        </div>
      `;
      })
      .join('');
  } else {
    workingPanel.classList.add('hidden');
  }

  // 5. Render Messages
  renderMessages();

  // 6. Privacy Stats Update
  renderStats(isWorking);

  // Auto scroll
  scrollAnchor.scrollIntoView({ behavior: 'smooth' });
}

function renderMessages() {
  messagesList.innerHTML = '';
  const isCompleted = currentStatus === 'completed';

  messages.forEach((msg, idx) => {
    const isLast = idx === messages.length - 1;
    const isLastAgent = isLast && msg.role === 'agent';

    if (msg.isError) {
      const errDiv = document.createElement('div');
      errDiv.className = 'error-row rise';
      errDiv.innerHTML = `
        <div class="error-avatar">${getAlertIconSvg()}</div>
        <div style="flex: 1;">
          <div class="error-title">Something went wrong</div>
          <div class="error-detail">${msg.text || 'The page changed during the task. Please try again.'}</div>
          <button class="retry-btn" id="retry-btn">Try again</button>
        </div>
      `;
      messagesList.appendChild(errDiv);

      const retryBtn = errDiv.querySelector('#retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', handleRetry);
      }
    } else {
      const msgDiv = document.createElement('div');
      msgDiv.className = `message-item ${msg.role} rise`;

      if (msg.role === 'agent') {
        msgDiv.innerHTML = `
          ${getAgentAvatarSvg()}
          <div class="message-bubble">${escapeHtml(msg.text)}</div>
        `;
      } else {
        msgDiv.innerHTML = `
          <div class="message-bubble">${escapeHtml(msg.text)}</div>
        `;
      }
      messagesList.appendChild(msgDiv);

      // If completed and last agent message, render completion checkmark
      if (isCompleted && isLastAgent) {
        const compDiv = document.createElement('div');
        compDiv.className = 'completion-row fade-in';
        compDiv.innerHTML = `
          ${getCheckIconSvg()}
          <span>Task completed</span>
        `;
        messagesList.appendChild(compDiv);
      }
    }
  });
}

function renderStats(isWorking) {
  if (isUnavailable) {
    privacyBadgeText.textContent = 'Inactive';
    privacyStatusBadge.classList.add('inactive');
    privacyBadgeDot.style.background = 'var(--text-3)';
    privacyProgressBar.style.width = '0%';
    progressScan.classList.add('hidden');
    if (statDataFound) statDataFound.textContent = '—';
    if (statSensitiveRecognized) statSensitiveRecognized.textContent = '—';
    if (statSensitiveRemoved) statSensitiveRemoved.textContent = '—';
    if (privacySummaryPercent) privacySummaryPercent.textContent = '0%';
  } else {
    privacyBadgeText.textContent = 'Protected';
    privacyStatusBadge.classList.remove('inactive');
    privacyBadgeDot.style.background = 'var(--green)';

    const percentProtected = stats.sensitiveRecognized > 0
      ? Math.round((stats.sensitiveRemoved / stats.sensitiveRecognized) * 100)
      : 100;

    privacyProgressBar.style.width = `${percentProtected}%`;

    if (isWorking) {
      progressScan.classList.remove('hidden');
    } else {
      progressScan.classList.add('hidden');
    }

    if (statDataFound) statDataFound.textContent = stats.dataFound.toLocaleString();
    if (statSensitiveRecognized) statSensitiveRecognized.textContent = stats.sensitiveRecognized.toLocaleString();
    if (statSensitiveRemoved) statSensitiveRemoved.textContent = stats.sensitiveRemoved.toLocaleString();
    if (privacySummaryPercent) privacySummaryPercent.textContent = `${percentProtected}%`;
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─────────────────────────────────────────────────────────
// Agent Execution Pipeline
// ─────────────────────────────────────────────────────────

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

function runAgentSequence(userText) {
  clearTimers();
  // 6 status steps spread across ~9 seconds.
  // The reply must never appear before the final step ('executing') has had
  // enough time to feel complete. doneDelay below is set to
  // delays[last] + 2500 so the user always sees the full pipeline first.
  // [connecting, reading_page, protecting_data, understanding_page, planning, executing]
  const delays = [0, 1500, 3000, 4500, 6000, 7500];

  // ── Inject content script + send START_AGENT ───────────
  // WHY: content_scripts in manifest.json only auto-inject into tabs
  // opened AFTER the extension loads. Reloading the extension or using
  // an already-open tab means the script isn't there, so sendMessage
  // silently fails with "Could not establish connection".
  //
  // FIX: use chrome.scripting.executeScript to force-inject agent.js
  // into the tab right now, then send the message. The IIFE in agent.js
  // is re-entrant safe (checks isActive flag), so re-injection is fine.
  if (activeTabId && chrome?.scripting?.executeScript) {
    chrome.scripting.executeScript(
      {
        target: { tabId: activeTabId },
        files:  ['content/agent.js'],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('[PrivSight] Script injection failed:', chrome.runtime.lastError.message);
          return;
        }
        // Script is now definitely in the tab — send the message
        chrome.tabs.sendMessage(
          activeTabId,
          { type: 'START_AGENT', prompt: userText },
          () => {
            if (chrome.runtime.lastError) {
              console.debug('[PrivSight] START_AGENT message:', chrome.runtime.lastError.message);
            }
          }
        );
      }
    );
  }

  // Step through status transitions
  WORKING_SEQUENCE.forEach((status, i) => {
    const t = setTimeout(() => {
      currentStatus = status;

      if (status === 'protecting_data') {
        stats.dataFound += 314;
        stats.sensitiveRecognized += 14;
        stats.sensitiveRemoved += 14;
      }
      if (status === 'understanding_page') {
        stats.dataFound += 418;
        stats.sensitiveRecognized += 9;
        stats.sensitiveRemoved += 9;
      }

      updateUI();
    }, delays[i]);
    timers.push(t);
  });

  // Completion response — fires 2.5 s after 'executing' starts,
  // ensuring the full pipeline is always visible before the reply appears.
  const doneDelay = delays[delays.length - 1] + 2500;
  const finishTimer = setTimeout(() => {
    const lower = userText.toLowerCase();
    const match = MOCK_RESPONSES.find(([k]) => lower.includes(k));
    const responseText = match
      ? match[1]
      : "I've analyzed this page and secured your session. How else can I assist you with this page?";

    messages.push({
      id: `agent-${Date.now()}`,
      role: 'agent',
      text: responseText,
      timestamp: Date.now(),
    });

    stats.sensitiveRemoved = stats.sensitiveRecognized;
    currentStatus = 'completed';
    updateUI();

    // Tell content script to remove the page overlay.
    // By this point agent.js was already injected at START_AGENT time,
    // so a direct sendMessage is sufficient.
    if (activeTabId && chrome?.tabs?.sendMessage) {
      chrome.tabs.sendMessage(activeTabId, { type: 'STOP_AGENT' }, () => {
        if (chrome.runtime.lastError) {
          console.debug('[PrivSight] STOP_AGENT:', chrome.runtime.lastError.message);
        }
      });
    }
  }, doneDelay);
  timers.push(finishTimer);

  // Return status to idle after completion notice
  const returnIdleTimer = setTimeout(() => {
    if (currentStatus === 'completed') {
      currentStatus = 'idle';
      updateUI();
    }
  }, doneDelay + 3200);
  timers.push(returnIdleTimer);
}

function handleSend() {
  const text = promptInput.value.trim();
  if (!text || STATUS_META[currentStatus]?.working || isUnavailable) return;

  messages.push({
    id: `user-${Date.now()}`,
    role: 'user',
    text: text,
    timestamp: Date.now(),
  });

  promptInput.value = '';
  promptInput.style.height = 'auto';
  updateUI();

  runAgentSequence(text);
}

function handleRetry() {
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) return;

  messages = messages.filter((m) => !m.isError);
  currentStatus = 'idle';
  updateUI();

  setTimeout(() => {
    runAgentSequence(lastUserMsg.text);
  }, 100);
}

// ─────────────────────────────────────────────────────────
// Tab Verification
// ─────────────────────────────────────────────────────────

function checkCurrentTab() {
  if (!chrome?.tabs?.query) {
    // Development / standalone fallback
    currentStatus = 'idle';
    updateUI();
    return;
  }

  const handleTab = (tab) => {
    if (tab && tab.id) {
      activeTabId = tab.id;
      const url = tab.url || '';

      if (
        url.startsWith('chrome://') ||
        url.startsWith('brave://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('edge://') ||
        url.startsWith('about:') ||
        url.startsWith('view-source:')
      ) {
        isUnavailable = true;
        currentStatus = 'page_unavailable';
      } else {
        isUnavailable = false;
        currentStatus = 'idle';
      }
    } else {
      isUnavailable = true;
      currentStatus = 'page_unavailable';
    }
    updateUI();
  };

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const valid = tabs?.find(t => t.id && !t.url?.startsWith('chrome-extension://'));
    if (valid) {
      handleTab(valid);
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs2) => {
      const valid2 = tabs2?.find(t => t.id && !t.url?.startsWith('chrome-extension://')) || tabs2?.[0];
      handleTab(valid2);
    });
  });
}

// ─────────────────────────────────────────────────────────
// Event Listeners
// ─────────────────────────────────────────────────────────

// Auto-resizing textarea & enter key dispatch
promptInput.addEventListener('input', () => {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 75) + 'px';
  sendBtn.disabled = promptInput.value.trim().length === 0;
});

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

sendBtn.addEventListener('click', handleSend);

// Quick suggestions
document.querySelectorAll('.suggestion-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const query = btn.getAttribute('data-query');
    if (query) {
      promptInput.value = query;
      handleSend();
    }
  });
});

// Settings drawer toggles
settingsBtn.addEventListener('click', () => {
  settingsDrawer.classList.remove('hidden');
});

closeSettingsBtn.addEventListener('click', () => {
  settingsDrawer.classList.add('hidden');
});

clearChatBtn.addEventListener('click', () => {
  clearTimers();
  messages = [];
  stats = { ...DEFAULT_STATS };
  currentStatus = 'idle';
  settingsDrawer.classList.add('hidden');
  updateUI();
});

openTabBtn.addEventListener('click', () => {
  if (chrome?.tabs?.create) {
    chrome.tabs.create({ url: 'https://google.com' });
    window.close();
  }
});

// ─────────────────────────────────────────────────────────
// Theme Management (Light & Dark Mode)
// ─────────────────────────────────────────────────────────

function initTheme() {
  document.documentElement.setAttribute('data-theme', 'dark');
}

if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    clearTimers();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_AGENT', immediate: true }, () => {
          void chrome.runtime.lastError;
          window.close();
        });
      } else {
        window.close();
      }
    });
  });
}

if (dashboardBtn) {
  dashboardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });
}

// ─────────────────────────────────────────────────────────
// Cleanup on popup dismiss / close
// ─────────────────────────────────────────────────────────

function handlePopupClose() {
  clearTimers();
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_AGENT', immediate: true }, () => {
        void chrome.runtime.lastError;
      });
    }
  });
}

window.addEventListener('pagehide', handlePopupClose);
window.addEventListener('beforeunload', handlePopupClose);
window.addEventListener('unload', handlePopupClose);

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  checkCurrentTab();
});
