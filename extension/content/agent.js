/**
 * PrivSight — Unified Content Script (agent.js)
 *
 * Integrates:
 *  1. Premium Aurora viewport overlay & page lock
 *  2. Local PII Scrubbing (DOMRedactor)
 *  3. Interactive element mapping with stable data_hint markers
 *  4. High-fidelity sanitized screenshot capture (html2canvas) with visual hint badges
 *  5. On-device ONNX YuNet face redaction
 *  6. Autonomous action executor (CLICK, TYPE, SCROLL, GO_BACK, GO_FORWARD)
 *  7. User interactive pause/resume support for human-in-the-loop steps
 */

(function () {
  'use strict';

  // ── Re-injection guard ────────────────────────────────────────────────────
  // When the extension reloads / is updated, the old content-script context is
  // invalidated but window.__PRIVSIGHT_AGENT_INJECTED__ stays true, meaning a
  // hard `return` would leave the page with no listeners and no overlay.
  // Instead, call any previously-registered cleanup first, then re-register.
  if (typeof window.__PRIVSIGHT_AGENT_CLEANUP__ === 'function') {
    try { window.__PRIVSIGHT_AGENT_CLEANUP__(); } catch (_) {}
  }
  // Mark injected (allows future re-injection to clean up properly)
  window.__PRIVSIGHT_AGENT_INJECTED__ = true;

  const DEBUG = false;
  const api = typeof browser !== 'undefined' ? browser : chrome;

  // ─── Configuration & State ─────────────────────────────
  const CONFIG = {
    chars: '0123456789',
    selectors: "a, button, input, textarea, select, [role='button'], [role='link'], [role='checkbox'], [tabindex]:not([tabindex='-1'])",
    badgeClass: 'llm-hint-badge',
  };

  let activeHints = new Map();
  let overlayRoot = null;
  let agentTimer = null;
  let isActive = false;
  let isPageLocked = false;
  let isExecutingAgentAction = false;
  let isUserInteractiveMode = false;
  let overlayWatchdogTimer = null;

  // ─── Main Browser User Interaction Lock ───────────────────
  const BLOCKED_USER_EVENTS = [
    'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend',
    'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'pointercancel', 'click', 'dblclick', 'contextmenu', 'auxclick',
    'wheel', 'touchstart', 'touchend', 'touchmove', 'touchcancel',
    'dragstart', 'drag', 'drop', 'selectstart'
  ];

  function onBlockedUserEvent(e) {
    if (!isPageLocked || isExecutingAgentAction || isUserInteractiveMode) {
      return;
    }
    if (e.isTrusted) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    }
  }

  function onBlockedFocus(e) {
    if (!isPageLocked || isExecutingAgentAction || isUserInteractiveMode) {
      return;
    }
    if (e.isTrusted) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        try {
          document.activeElement.blur();
        } catch (_) {}
      }
    }
  }

  let isLockListenersAttached = false;
  function enableInteractionLock() {
    isPageLocked = true;
    isUserInteractiveMode = false;

    // Immediately blur active element so user cannot type if an input had focus
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      try {
        document.activeElement.blur();
      } catch (_) {}
    }

    if (!isLockListenersAttached) {
      BLOCKED_USER_EVENTS.forEach((evt) => {
        window.addEventListener(evt, onBlockedUserEvent, { capture: true, passive: false });
        document.addEventListener(evt, onBlockedUserEvent, { capture: true, passive: false });
      });
      window.addEventListener('focusin', onBlockedFocus, { capture: true, passive: false });
      window.addEventListener('focus', onBlockedFocus, { capture: true, passive: false });
      document.addEventListener('focusin', onBlockedFocus, { capture: true, passive: false });
      isLockListenersAttached = true;
    }
  }

  function disableInteractionLock() {
    isPageLocked = false;
    isUserInteractiveMode = false;
  }

  // ─── Styles (injected into Shadow DOM for Aurora Overlay) ─────────────────
  const OVERLAY_CSS = `
    .privsight-shell {
      position: absolute;
      inset: 0;
      pointer-events: all !important;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      transition: opacity 0.3s ease;
      cursor: wait !important;
      user-select: none !important;
      -webkit-user-select: none !important;
    }

    .privsight-shell.interactive {
      pointer-events: none !important;
      cursor: default !important;
      user-select: auto !important;
      -webkit-user-select: auto !important;
    }

    .veil {
      position: absolute;
      inset: 0;
      background: rgba(4, 6, 14, 0.08);
      animation: veil-in 0.4s ease-out both;
      transition: opacity 0.3s ease;
    }

    .privsight-shell.interactive .veil {
      opacity: 0 !important;
      pointer-events: none;
    }

    @keyframes veil-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* Ambient Inset Perimeter Blue Glow */
    .aurora-ambient-glow {
      position: absolute;
      inset: 0;
      pointer-events: none;
      box-shadow:
        inset 0 0 30px rgba(56, 189, 248, 0.18),
        inset 0 0 70px rgba(56, 189, 248, 0.10),
        inset 0 0 120px rgba(56, 189, 248, 0.06);
      animation: ambient-pulse 3s ease-in-out infinite alternate;
      transition: opacity 0.3s ease;
    }

    .privsight-shell.interactive .aurora-ambient-glow {
      opacity: 0.35;
    }

    @keyframes ambient-pulse {
      0%   { opacity: 0.55; }
      100% { opacity: 0.85; }
    }

    /* Blue Outline Edge Beams */
    .aurora-edge {
      position: absolute;
      pointer-events: none;
      z-index: 10;
      transition: opacity 0.3s ease;
    }

    .privsight-shell.interactive .aurora-edge {
      opacity: 0.6;
    }

    .aurora-top {
      top: 0; left: 0; right: 0;
      height: 3.5px;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(56, 189, 248, 0.08) 8%,
        rgba(56, 189, 248, 0.75) 25%,
        rgba(125, 211, 252, 0.88) 50%,
        rgba(56, 189, 248, 0.75) 75%,
        rgba(56, 189, 248, 0.08) 92%,
        transparent 100%
      );
      background-size: 200% 100%;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.55), 0 0 22px rgba(56, 189, 248, 0.28);
      animation: aurora-sweep-h 3s linear infinite;
    }

    .aurora-bottom {
      bottom: 0; left: 0; right: 0;
      height: 3.5px;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(56, 189, 248, 0.08) 8%,
        rgba(56, 189, 248, 0.75) 25%,
        rgba(125, 211, 252, 0.88) 50%,
        rgba(56, 189, 248, 0.75) 75%,
        rgba(56, 189, 248, 0.08) 92%,
        transparent 100%
      );
      background-size: 200% 100%;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.55), 0 0 22px rgba(56, 189, 248, 0.28);
      animation: aurora-sweep-h 3.6s linear infinite reverse;
    }

    .aurora-left {
      left: 0; top: 0; bottom: 0;
      width: 3.5px;
      background: linear-gradient(
        180deg,
        transparent 0%,
        rgba(56, 189, 248, 0.08) 8%,
        rgba(56, 189, 248, 0.75) 25%,
        rgba(125, 211, 252, 0.88) 50%,
        rgba(56, 189, 248, 0.75) 75%,
        rgba(56, 189, 248, 0.08) 92%,
        transparent 100%
      );
      background-size: 100% 200%;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.55), 0 0 22px rgba(56, 189, 248, 0.28);
      animation: aurora-sweep-v 3.2s linear infinite;
    }

    .aurora-right {
      right: 0; top: 0; bottom: 0;
      width: 3.5px;
      background: linear-gradient(
        180deg,
        transparent 0%,
        rgba(56, 189, 248, 0.08) 8%,
        rgba(56, 189, 248, 0.75) 25%,
        rgba(125, 211, 252, 0.88) 50%,
        rgba(56, 189, 248, 0.75) 75%,
        rgba(56, 189, 248, 0.08) 92%,
        transparent 100%
      );
      background-size: 100% 200%;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.55), 0 0 22px rgba(56, 189, 248, 0.28);
      animation: aurora-sweep-v 3.8s linear infinite reverse;
    }

    @keyframes aurora-sweep-h {
      0%   { background-position: 0% 50%; }
      100% { background-position: 200% 50%; }
    }

    @keyframes aurora-sweep-v {
      0%   { background-position: 50% 0%; }
      100% { background-position: 50% 200%; }
    }

    /* Corner Blue Blooms */
    .aurora-corner {
      position: absolute;
      width: 160px;
      height: 160px;
      pointer-events: none;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.22) 0%, transparent 70%);
      animation: corner-breathe 3.6s ease-in-out infinite;
      transition: opacity 0.3s ease;
    }

    .privsight-shell.interactive .aurora-corner {
      opacity: 0.25;
    }

    .aurora-corner-tl { top: -50px;    left: -50px;  animation-delay: 0s;    }
    .aurora-corner-tr { top: -50px;    right: -50px; animation-delay: -0.9s; }
    .aurora-corner-bl { bottom: -50px; left: -50px;  animation-delay: -1.8s; }
    .aurora-corner-br { bottom: -50px; right: -50px; animation-delay: -2.7s; }

    @keyframes corner-breathe {
      0%, 100% { opacity: 0.35; transform: scale(0.95); }
      50%       { opacity: 0.65; transform: scale(1.10); }
    }
    .privsight-shell.leaving {
      animation: overlay-out 0.35s ease-in both;
      pointer-events: none !important;
    }

    @keyframes overlay-out {
      from { opacity: 1; }
      to   { opacity: 0; }
    }
  `;

  // ─── Build & Inject Aurora Overlay ─────────────────────────────
  function startOverlayWatchdog() {
    if (overlayWatchdogTimer) return;
    overlayWatchdogTimer = setInterval(() => {
      if (isActive && isPageLocked && !isUserInteractiveMode) {
        const el = document.getElementById('privsight-overlay');
        const targetParent = document.body || document.documentElement;
        if (!el || !el.parentNode || el.parentNode !== targetParent) {
          console.debug('[PrivSight] Watchdog re-ensuring Aurora overlay presence');
          createOverlay();
        }
      } else if (!isActive) {
        stopOverlayWatchdog();
      }
    }, 1200);
  }

  function stopOverlayWatchdog() {
    if (overlayWatchdogTimer) {
      clearInterval(overlayWatchdogTimer);
      overlayWatchdogTimer = null;
    }
  }

  function createOverlay() {
    enableInteractionLock();

    let host = document.getElementById('privsight-overlay');
    if (host && host.shadowRoot) {
      isActive = true;
      host.style.display = 'block';
      host.style.pointerEvents = isUserInteractiveMode ? 'none' : 'all';
      host.style.cursor = isUserInteractiveMode ? 'default' : 'wait';
      const shell = host.shadowRoot.querySelector('.privsight-shell');
      if (shell) {
        shell.classList.remove('leaving');
        if (isUserInteractiveMode) {
          shell.classList.add('interactive');
        } else {
          shell.classList.remove('interactive');
        }
      }
      const targetParent = document.documentElement || document.body;
      if (!host.parentNode || host.parentNode !== targetParent) {
        targetParent.appendChild(host);
      }
      // Restore !important properties in case page CSS reset them
      const hS2 = host.style;
      hS2.setProperty('display',      'block',   'important');
      hS2.setProperty('visibility',   'visible', 'important');
      hS2.setProperty('opacity',      '1',       'important');
      hS2.setProperty('position',     'fixed',   'important');
      hS2.setProperty('top',          '0px',     'important');
      hS2.setProperty('left',         '0px',     'important');
      hS2.setProperty('z-index',      '2147483647', 'important');
      hS2.setProperty('width',        '100vw',   'important');
      hS2.setProperty('height',       '100vh',   'important');
      overlayRoot = { host, shell };
      startOverlayWatchdog();
      return;
    }

    if (host) host.remove();
    isActive = true;

    host = document.createElement('div');
    host.id = 'privsight-overlay';
    host.setAttribute('aria-hidden', 'true');
    // Use setProperty with !important so host-page resets (Google, SPAs, etc.)
    // cannot override the overlay's fixed positioning or visibility.
    const hS = host.style;
    hS.setProperty('position',       'fixed',           'important');
    hS.setProperty('top',            '0px',             'important');
    hS.setProperty('left',           '0px',             'important');
    hS.setProperty('right',          '0px',             'important');
    hS.setProperty('bottom',         '0px',             'important');
    hS.setProperty('width',          '100vw',           'important');
    hS.setProperty('height',         '100vh',           'important');
    hS.setProperty('margin',         '0px',             'important');
    hS.setProperty('padding',        '0px',             'important');
    hS.setProperty('z-index',        '2147483647',      'important');
    hS.setProperty('pointer-events', isUserInteractiveMode ? 'none' : 'all', 'important');
    hS.setProperty('overflow',       'hidden',          'important');
    hS.setProperty('display',        'block',           'important');
    hS.setProperty('cursor',         isUserInteractiveMode ? 'default' : 'wait', 'important');
    hS.setProperty('visibility',     'visible',         'important');
    hS.setProperty('opacity',        '1',               'important');
    hS.setProperty('transform',      'none',            'important');
    hS.setProperty('clip',           'auto',            'important');
    hS.setProperty('clip-path',      'none',            'important');

    const shadow = host.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = OVERLAY_CSS;
    shadow.appendChild(styleEl);

    const shell = document.createElement('div');
    shell.className = `privsight-shell ${isUserInteractiveMode ? 'interactive' : ''}`;

    const veil = document.createElement('div');
    veil.className = 'veil';
    shell.appendChild(veil);

    const ambientGlow = document.createElement('div');
    ambientGlow.className = 'aurora-ambient-glow';
    shell.appendChild(ambientGlow);

    ['aurora-edge aurora-top', 'aurora-edge aurora-bottom',
     'aurora-edge aurora-left', 'aurora-edge aurora-right'].forEach((cls) => {
      const el = document.createElement('div');
      el.className = cls;
      shell.appendChild(el);
    });

    ['aurora-corner aurora-corner-tl', 'aurora-corner aurora-corner-tr',
     'aurora-corner aurora-corner-bl', 'aurora-corner aurora-corner-br'].forEach((cls) => {
      const el = document.createElement('div');
      el.className = cls;
      shell.appendChild(el);
    });
    shadow.appendChild(shell);

    // Prefer documentElement so overlay works even before <body> exists
    const targetParent = document.documentElement || document.body;
    targetParent.appendChild(host);
    overlayRoot = { host, shell };
    startOverlayWatchdog();
  }

  // ─── Screenshot isolation helpers ────────────────────────────────────────
  // Hide overlay ONLY for the ~30ms capture window so the AI vision model
  // does not see the blue borders/logo in the screenshot.
  function hideOverlayForCapture() {
    const h = overlayRoot?.host || document.getElementById('privsight-overlay');
    if (h) {
      h.style.setProperty('visibility', 'hidden', 'important');
      h.style.setProperty('opacity',    '0',       'important');
    }
  }

  function showOverlayAfterCapture() {
    const h = overlayRoot?.host || document.getElementById('privsight-overlay');
    if (h) {
      h.style.setProperty('visibility', 'visible', 'important');
      h.style.setProperty('opacity',    '1',       'important');
    }
  }

  function setOverlayInteractive(allowUserInteraction) {
    isUserInteractiveMode = Boolean(allowUserInteraction);
    if (allowUserInteraction) {
      isPageLocked = false;
    } else {
      enableInteractionLock();
    }

    if (!overlayRoot) return;
    if (allowUserInteraction) {
      overlayRoot.shell.classList.add('interactive');
      overlayRoot.host.style.setProperty('pointer-events', 'none',    'important');
      overlayRoot.host.style.setProperty('cursor',         'default', 'important');
    } else {
      overlayRoot.shell.classList.remove('interactive');
      overlayRoot.host.style.setProperty('pointer-events', 'all',  'important');
      overlayRoot.host.style.setProperty('cursor',         'wait', 'important');
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        try {
          document.activeElement.blur();
        } catch (_) {}
      }
    }
  }


  function removeOverlay(immediate = false) {
    stopOverlayWatchdog();
    disableInteractionLock();
    if (!overlayRoot) {
      isActive = false;
      const leftover = document.getElementById('privsight-overlay');
      if (leftover) leftover.remove();
      return;
    }
    const { host, shell } = overlayRoot;
    isActive = false;

    if (immediate) {
      if (host.parentNode) host.parentNode.removeChild(host);
      overlayRoot = null;
      return;
    }

    shell.classList.add('leaving');
    setTimeout(() => {
      if (host.parentNode) host.parentNode.removeChild(host);
      overlayRoot = null;
    }, 420);
  }

  // ─── DOM Redactor & Sanitization Helpers ─────────────────
  let redactorInstance = null;
  function getRedactor() {
    if (!redactorInstance && typeof DOMRedactor !== 'undefined') {
      redactorInstance = new DOMRedactor({
        redactTextNodes: true,
        redactInputs: true,
      });
    }
    return redactorInstance;
  }

  function generateHintString(index, chars) {
    let hint = '';
    let len = chars.length;
    index += 1;
    while (index > 0) {
      index -= 1;
      hint = chars[index % len] + hint;
      index = Math.floor(index / len);
    }
    return hint;
  }

  // ─── Capture & Hints Engine ─────────────────────────────
  async function capturePage() {
    // Ensure page DOM and all resources (images, stylesheets) are completely loaded
    if (document.readyState !== 'complete') {
      await new Promise((resolve) => {
        if (document.readyState === 'complete') return resolve();
        window.addEventListener('load', resolve, { once: true });
        setTimeout(resolve, 2500); // Safety fallback timeout
      });
    }

    // Ensure the Aurora blue outline and logo are actively displayed
    if (!overlayRoot || !document.getElementById('privsight-overlay')) {
      createOverlay();
    }

    activeHints.clear();
    const redactor = getRedactor();

    // 1. Redact live DOM in-place, keeping track of undo list and scrubbing stats
    let undoList = [];
    let scrubbingStats = { dataFound: 0, sensitiveRecognized: 0, sensitiveRemoved: 0 };

    if (redactor && typeof redactor.redactLiveDOM === 'function') {
      try {
        const redactResult = redactor.redactLiveDOM(document.body || document.documentElement);
        undoList = redactResult.undoList || [];
        const s = redactResult.stats || {};
        let sensitiveCount = 0;
        Object.keys(s).forEach((k) => {
          if (typeof s[k] === 'number' && k !== 'total') sensitiveCount += s[k];
        });
        scrubbingStats = {
          dataFound: sensitiveCount,
          sensitiveRecognized: sensitiveCount,
          sensitiveRemoved: sensitiveCount,
        };
      } catch (redactErr) {
        console.warn('[PrivSight] Live DOM redaction error:', redactErr);
      }
    }

    // 2. Query visible interactive elements STRICTLY inside the current viewport
    const vpWidth = window.innerWidth || document.documentElement.clientWidth;
    const vpHeight = window.innerHeight || document.documentElement.clientHeight;

    const orgElements = Array.from(document.querySelectorAll(CONFIG.selectors)).filter((el) => {
      if (el.closest('#privsight-overlay') || el.closest('#privsight-hint-container')) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);

      // Must have dimensions and be visually displayed
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        style.visibility === 'hidden' ||
        style.display === 'none' ||
        style.opacity === '0'
      ) {
        return false;
      }

      // Check strictly against the visible viewport
      const inViewport = (
        rect.top < vpHeight &&
        rect.bottom > 0 &&
        rect.left < vpWidth &&
        rect.right > 0
      );

      return inViewport;
    });

    scrubbingStats.dataFound += orgElements.length;

    // 3. Assign data-hint, add class to elements, and create UI hint badges for viewport elements
    const sanitizedDom = [];
    let hintContainer = document.getElementById('privsight-hint-container');
    if (hintContainer) hintContainer.remove();

    hintContainer = document.createElement('div');
    hintContainer.id = 'privsight-hint-container';
    hintContainer.setAttribute('aria-hidden', 'true');
    Object.assign(hintContainer.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      pointerEvents: 'none',
      zIndex: '2147483646',
      overflow: 'hidden',
    });

    orgElements.forEach((el, index) => {
      const hint = String(index);
      activeHints.set(hint, el);
      el.setAttribute('data-hint', hint);
      el.classList.add('privsight-target-hint');

      // Create visual number badge for UI positioned directly over the viewport coordinates
      const rect = el.getBoundingClientRect();
      const badge = document.createElement('span');
      badge.className = CONFIG.badgeClass || 'llm-hint-badge';
      badge.textContent = hint;
      Object.assign(badge.style, {
        position: 'fixed',
        top: `${Math.max(0, Math.round(rect.top))}px`,
        left: `${Math.max(0, Math.round(rect.left))}px`,
        background: '#ffeb3b',
        color: '#000000',
        border: '1px solid #f57f17',
        borderRadius: '2px',
        padding: '0 3px',
        fontSize: '11px',
        fontWeight: 'bold',
        fontFamily: 'sans-serif',
        lineHeight: '13px',
        height: '13px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: '2147483646',
      });
      hintContainer.appendChild(badge);

      // ── Derive richer element metadata for the new backend snapshot schema ──
      const tagName = el.tagName ? el.tagName.toLowerCase() : 'div';

      // ARIA role: prefer explicit role attribute, fall back to implicit role by tag
      const explicitRole = el.getAttribute('role') || null;
      const implicitRoleMap = {
        a: 'link', button: 'button', input: 'textbox', textarea: 'textbox',
        select: 'listbox', img: 'img', checkbox: 'checkbox', radio: 'radio',
      };
      const inputType = tagName === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : null;
      const implicitRole = inputType === 'checkbox' ? 'checkbox'
        : inputType === 'radio' ? 'radio'
        : implicitRoleMap[tagName] || null;
      const role = explicitRole || implicitRole;

      // Visible text content (aria-label preferred, then textContent, then value/placeholder)
      let textContent = null;
      const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || null;
      if (ariaLabel) {
        textContent = ariaLabel.trim() || null;
      } else if (tagName !== 'input' && tagName !== 'textarea' && tagName !== 'select') {
        const raw = (el.textContent || '').trim();
        textContent = raw.length > 0 && raw.length <= 200 ? raw : (raw.length > 200 ? raw.substring(0, 200) + '…' : null);
      }

      // Current value (for inputs/textareas/selects)
      let elementValue = null;
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        elementValue = (el.value || el.getAttribute('value') || el.getAttribute('placeholder') || null);
      }

      // Redaction: detect if this element's text or value was scrubbed
      const isRedacted = (
        (textContent && textContent.includes('[REDACTED]')) ||
        (elementValue && elementValue.includes('[REDACTED]'))
      );

      // Determine redaction reason based on input type / field characteristics
      let redactionReason = undefined;
      if (isRedacted) {
        const inputTypeAttr = (el.getAttribute('type') || '').toLowerCase();
        if (inputTypeAttr === 'password') {
          redactionReason = 'password';
        } else if (tagName === 'img') {
          redactionReason = 'contains_face';
        } else {
          redactionReason = 'pii';
        }
      }

      // If redacted, strip the actual [REDACTED] placeholder from what we send
      const safeText  = isRedacted ? null : textContent;
      const safeValue = isRedacted ? null : elementValue;

      // Unified element descriptor compatible with the new backend snapshot schema
      sanitizedDom.push({
        // New backend fields
        mark_id:          index,
        tag:              tagName,
        role:             role,
        text:             safeText,
        value:            safeValue,
        redacted:         isRedacted,
        redaction_reason: redactionReason,
        // Legacy field kept for backward compatibility with action executor (findElement)
        data_hint:        hint,
      });
    });

    (document.documentElement || document.body).appendChild(hintContainer);

    let screenshotB64 = '';
    try {
      // 4. Capture screenshot — hide Aurora overlay only for the ~30ms capture
      // window so the AI vision model never sees the borders/logo, then restore.
      hideOverlayForCapture();

      // Two-frame flush: ensures browser composites the hidden overlay before
      // the GPU-accelerated capture path reads the framebuffer.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 25));

      let capturedDataUrl = null;
      try {
        capturedDataUrl = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (!response?.ok || !response?.dataUrl) {
              reject(new Error(response?.error || 'Empty captureVisibleTab response'));
            } else {
              resolve(response.dataUrl);
            }
          });
        });
      } catch (tabCaptureErr) {
        console.warn('[PrivSight] Inbuilt captureVisibleTab failed, falling back to html2canvas:', tabCaptureErr);
        if (typeof html2canvas !== 'undefined') {
          const canvas = await html2canvas(document.body, {
            x: window.scrollX,
            y: window.scrollY,
            width: window.innerWidth,
            height: window.innerHeight,
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight,
            scale: 1,
            useCORS: true,
            logging: false,
            ignoreElements: (element) => element.id === 'privsight-overlay',
          });
          capturedDataUrl = canvas.toDataURL('image/png');
        }
      } finally {
        // Immediately restore Aurora overlay — it was gone for ≤~55ms total
        showOverlayAfterCapture();
      }

      // Remove hint badges immediately after screenshot is captured
      if (hintContainer && hintContainer.parentNode) {
        hintContainer.parentNode.removeChild(hintContainer);
        hintContainer = null;
      }
      orgElements.forEach((el) => {
        el.classList.remove('privsight-target-hint');
      });

      // Restore redacted DOM info immediately
      if (redactor && typeof redactor.restoreLiveDOM === 'function' && undoList.length > 0) {
        try {
          redactor.restoreLiveDOM(undoList);
          undoList = [];
        } catch (restoreErr) {
          console.warn('[PrivSight] Live DOM restore error:', restoreErr);
        }
      }

      if (capturedDataUrl) {
        let processedDataUrl = capturedDataUrl;

        // 5. Face redaction pass on screenshot using YuNet ONNX (Aurora overlay is actively glowing)
        if (typeof window.faceRedaction === 'function') {
          try {
            processedDataUrl = await window.faceRedaction(capturedDataUrl);
          } catch (e) {
            console.warn('[PrivSight] Face redaction pass warning:', e);
          }
        }

        // 6. QR code masking pass — runs after face redaction, same in-memory data URL
        if (typeof window.qrRedaction === 'function') {
          try {
            processedDataUrl = await window.qrRedaction(processedDataUrl);
          } catch (e) {
            console.warn('[PrivSight] QR redaction pass warning:', e);
          }
        }

        screenshotB64 = processedDataUrl.replace(/^data:image\/[a-zA-Z+.-]+;base64,/, '');

      }
    } catch (err) {
      console.warn('[PrivSight] Screenshot capture warning:', err);
    } finally {
      // 6. Ensure badges and redactions are cleaned if an early error occurred
      if (hintContainer && hintContainer.parentNode) {
        hintContainer.parentNode.removeChild(hintContainer);
      }
      orgElements.forEach((el) => {
        el.classList.remove('privsight-target-hint');
      });

      // 7. Restore redacted info in the live DOM
      if (redactor && typeof redactor.restoreLiveDOM === 'function' && undoList.length > 0) {
        try {
          redactor.restoreLiveDOM(undoList);
        } catch (restoreErr) {
          console.warn('[PrivSight] Live DOM restore error:', restoreErr);
        }
      }
    }

    // 8. Return sanitized DOM and screenshot payload to send to backend
    return {
      sanitized_dom: sanitizedDom,
      sanitized_screenshot_b64: screenshotB64,
      stats: scrubbingStats,
    };
  }

  // ─── Action Executor Engine ─────────────────────────────
  function findElement(dataHint, elementId) {
    if (dataHint && activeHints.has(String(dataHint))) {
      return activeHints.get(String(dataHint));
    }
    if (dataHint) {
      const el = document.querySelector(`[data-hint="${dataHint}"]`);
      if (el) return el;
    }
    if (elementId) {
      const el = document.getElementById(elementId);
      if (el) return el;
    }
    return null;
  }

  async function executeAction(action) {
    if (!action || !action.type) {
      throw new Error('Invalid action payload: action.type is required');
    }

    const type = action.type.toUpperCase();
    console.log(`[PrivSight Executor] Executing action: ${type}`, action);

    // Ensure overlay is active during action execution
    if (!overlayRoot || !document.getElementById('privsight-overlay')) {
      createOverlay();
    }

    isExecutingAgentAction = true;
    try {
      switch (type) {
        case 'CLICK': {
          const el = findElement(action.data_hint, action.element_id);
          if (!el) {
            throw new Error(`Target element not found for CLICK (hint: ${action.data_hint}, id: ${action.element_id})`);
          }
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await new Promise((r) => setTimeout(r, 200));

          // Dispatch full mouse event sequence for web frameworks (React, Angular, etc.)
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          el.focus();
          el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          el.click();
          break;
        }

        case 'TYPE': {
          const el = findElement(action.data_hint, action.element_id);
          if (!el) {
            throw new Error(`Target element not found for TYPE (hint: ${action.data_hint}, id: ${action.element_id})`);
          }
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.focus();

          const textToType = action.text || '';

          // React / modern SPA input value setter compatibility
          const valuePrototype = el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          const nativeInputSetter = Object.getOwnPropertyDescriptor(valuePrototype, 'value')?.set;

          if (nativeInputSetter) {
            nativeInputSetter.call(el, textToType);
          } else {
            el.value = textToType;
          }

          // Update the element attribute so subsequent scans read the updated value
          el.setAttribute('value', textToType);

          el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
          break;
        }

        case 'SCROLL': {
          // Default to scrolling down one viewport
          window.scrollBy({
            top: window.innerHeight * 0.85,
            left: 0,
            behavior: 'smooth',
          });
          await new Promise((r) => setTimeout(r, 400));
          break;
        }

        case 'GO_BACK': {
          window.history.back();
          await new Promise((r) => setTimeout(r, 400));
          break;
        }

        case 'GO_FORWARD': {
          window.history.forward();
          await new Promise((r) => setTimeout(r, 400));
          break;
        }

        default:
          console.warn(`[PrivSight Executor] Unhandled action type: ${type}`);
      }
    } finally {
      // Blur any element left focused so user cannot physically type into it
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        try {
          document.activeElement.blur();
        } catch (_) {}
      }
      isExecutingAgentAction = false;
    }

    // Allow browser layout and DOM mutation observers to settle
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true, actionType: type };
  }

  // ─── Chrome Message Handlers ─────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // 1. Overlay & Page Lock Controls
    if (message.type === 'START_AGENT') {
      createOverlay();
      sendResponse({ ok: true, status: 'overlay_active' });
      return true;
    }

    if (message.type === 'STOP_AGENT') {
      removeOverlay(message.immediate || false);
      sendResponse({ ok: true, status: 'overlay_removed' });
      return true;
    }

    // 2. Human-in-the-loop pause / resume
    if (message.type === 'PAUSE_USER_MODE') {
      setOverlayInteractive(true);
      sendResponse({ ok: true, status: 'interactive_paused' });
      return true;
    }

    if (message.type === 'RESUME_AGENT_MODE') {
      setOverlayInteractive(false);
      sendResponse({ ok: true, status: 'interactive_resumed' });
      return true;
    }

    // 3. Capture Page State (Sanitized DOM + Screenshot)
    if (message.type === 'CAPTURE_STATE' || message.action === 'TRIGGER_CAPTURE') {
      capturePage()
        .then((result) => {
          sendResponse({ ok: true, data: result });
        })
        .catch((err) => {
          console.error('[PrivSight] Capture error:', err);
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }

    // 4. Action Execution
    if (message.type === 'EXECUTE_ACTION') {
      executeAction(message.action)
        .then((res) => {
          safePostMessage(bgPort, { type: 'STEP_DONE', result: res });
          sendResponse({ ok: true, result: res });
        })
        .catch((err) => {
          console.error('[PrivSight] Execution error:', err);
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }

    return true;
  });

  // ─── Background Port & Lifecycle Sync ───────────────────
  let bgPort = null;

  function safePostMessage(port, msg) {
    if (!port) return;
    try {
      port.postMessage(msg);
    } catch (err) {
      const msgStr = err?.message || String(err);
      if (
        msgStr.includes('message channel is closed') ||
        msgStr.includes('context invalidated') ||
        msgStr.includes('Extension context invalidated')
      ) {
        console.debug('[PrivSight Agent] Message channel closed during expected navigation/bfcache lifecycle.');
      } else {
        console.warn('[PrivSight Agent] safePostMessage error:', err);
      }
    }
  }

  function handleStateUpdate(state) {
    if (!state) return;
    if (state.isRunning && state.isOverlayActive) {
      if (!isActive) {
        createOverlay();
      }
      if (state.interactive) {
        setOverlayInteractive(true);
      }
    } else if (state.isRunning === false) {
      removeOverlay(true);
    }
  }

  function connectToBackground() {
    try {
      bgPort = chrome.runtime.connect({ name: 'privsight-agent' });

      bgPort.onDisconnect.addListener(() => {
        // Non-destructive: expected when page navigates or enters bfcache
        void chrome.runtime.lastError;
        bgPort = null;
        console.debug('[PrivSight Agent] Port disconnected (expected on navigation).');
      });

      bgPort.onMessage.addListener((msg) => {
        if (msg.type === 'STATE_RESPONSE' || msg.type === 'STATE_UPDATE') {
          handleStateUpdate(msg.state);
        }
      });

      // Immediately query background for active execution state
      safePostMessage(bgPort, { type: 'GET_STATE' });
    } catch (err) {
      console.debug('[PrivSight Agent] Port connect notice:', err);
    }
  }

  // Connect and sync state immediately on content script load
  connectToBackground();

  // ── Cleanup registration ──────────────────────────────────────────────────
  // Called by the re-injection guard at the top of the IIFE when the extension
  // reloads, so old listeners + overlay are torn down before new ones register.
  window.__PRIVSIGHT_AGENT_CLEANUP__ = function cleanup() {
    stopOverlayWatchdog();
    disableInteractionLock();
    clearTimeout(agentTimer);
    if (overlayRoot && overlayRoot.host && overlayRoot.host.parentNode) {
      overlayRoot.host.parentNode.removeChild(overlayRoot.host);
    }
    // Also nuke any orphan overlay from a previous failed injection
    const orphan = document.getElementById('privsight-overlay');
    if (orphan && orphan.parentNode) orphan.parentNode.removeChild(orphan);
    overlayRoot = null;
    isActive = false;
    isPageLocked = false;
    isLockListenersAttached = false;
    bgPort = null;
    // Remove ourselves so the next injection registers fresh
    window.__PRIVSIGHT_AGENT_CLEANUP__ = null;
    window.__PRIVSIGHT_AGENT_INJECTED__ = false;
  };

  window.addEventListener('pagehide', () => {
    stopOverlayWatchdog();
    disableInteractionLock();
    clearTimeout(agentTimer);
    if (overlayRoot && overlayRoot.host && overlayRoot.host.parentNode) {
      overlayRoot.host.parentNode.removeChild(overlayRoot.host);
    }
    overlayRoot = null;
    isActive = false;
  });

  console.log('[PrivSight] Unified content agent initialized.');
})();

