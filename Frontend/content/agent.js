/**
 * PrivSight — Unified Content Script (agent.js)
 *
 * Integrates:
 *  1. Premium Aurora viewport overlay & page lock
 *  2. Local PII Scrubbing (DOMRedactor)
 *  3. Interactive element mapping with stable data_hint markers
 *  4. High-fidelity sanitized screenshot capture (html2canvas) with visual hint badges
 *  5. On-device ONNX YuNet face redaction
 *  6. Autonomous action executor (CLICK, TYPE, SCROLL)
 *  7. User interactive pause/resume support for human-in-the-loop steps
 */

(function () {
  'use strict';

  if (window.__PRIVSIGHT_AGENT_INJECTED__) {
    return;
  }
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

  // ─── Styles (injected into Shadow DOM for Aurora Overlay) ─────────────────
  const OVERLAY_CSS = `
    .privsight-shell {
      position: absolute;
      inset: 0;
      pointer-events: all;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      transition: opacity 0.3s ease;
    }

    .privsight-shell.interactive {
      pointer-events: none !important;
    }

    .veil {
      position: absolute;
      inset: 0;
      background: rgba(4, 4, 10, 0.28);
      backdrop-filter: blur(0.5px);
      -webkit-backdrop-filter: blur(0.5px);
      animation: veil-in 0.55s ease-out both;
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

    .aurora-edge {
      position: absolute;
      pointer-events: none;
      z-index: 10;
    }

    .aurora-top {
      top: 0; left: 0; right: 0;
      height: 3.5px;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(56, 189, 248, 0.0)   5%,
        rgba(56, 189, 248, 0.8)  25%,
        rgba(99, 210, 255, 1.0)  50%,
        rgba(56, 189, 248, 0.8)  75%,
        rgba(56, 189, 248, 0.0)  95%,
        transparent 100%
      );
      box-shadow: 0 0 14px rgba(56, 189, 248, 0.65);
      animation: aurora-h 3.2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }

    .aurora-bottom {
      bottom: 0; left: 0; right: 0;
      height: 3.5px;
      background: linear-gradient(
        90deg,
        transparent 0%,
        rgba(56, 189, 248, 0.0)   5%,
        rgba(56, 189, 248, 0.75) 25%,
        rgba(125, 211, 252, 0.95) 50%,
        rgba(56, 189, 248, 0.75) 75%,
        rgba(56, 189, 248, 0.0)  95%,
        transparent 100%
      );
      box-shadow: 0 0 14px rgba(56, 189, 248, 0.65);
      animation: aurora-h 4.1s cubic-bezier(0.4, 0, 0.6, 1) infinite reverse;
      animation-delay: -1.3s;
    }

    .aurora-left {
      left: 0; top: 0; bottom: 0;
      width: 3.5px;
      background: linear-gradient(
        180deg,
        transparent 0%,
        rgba(56, 189, 248, 0.0)  5%,
        rgba(56, 189, 248, 0.75) 25%,
        rgba(125, 211, 252, 0.95) 50%,
        rgba(56, 189, 248, 0.75) 75%,
        rgba(56, 189, 248, 0.0)  95%,
        transparent 100%
      );
      box-shadow: 0 0 14px rgba(56, 189, 248, 0.65);
      animation: aurora-v 3.8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
      animation-delay: -0.8s;
    }

    .aurora-right {
      right: 0; top: 0; bottom: 0;
      width: 3.5px;
      background: linear-gradient(
        180deg,
        transparent 0%,
        rgba(56, 189, 248, 0.0)  5%,
        rgba(56, 189, 248, 0.75) 25%,
        rgba(99, 210, 255, 0.95) 50%,
        rgba(56, 189, 248, 0.75) 75%,
        rgba(56, 189, 248, 0.0)  95%,
        transparent 100%
      );
      box-shadow: 0 0 14px rgba(56, 189, 248, 0.65);
      animation: aurora-v 4.6s cubic-bezier(0.4, 0, 0.6, 1) infinite reverse;
      animation-delay: -2.1s;
    }

    .aurora-corner {
      position: absolute;
      width: 120px;
      height: 120px;
      pointer-events: none;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.18) 0%, transparent 70%);
      animation: corner-breathe 3.6s ease-in-out infinite;
    }
    .aurora-corner-tl { top: -30px;    left: -30px;  animation-delay: 0s;    }
    .aurora-corner-tr { top: -30px;    right: -30px; animation-delay: -0.9s; }
    .aurora-corner-bl { bottom: -30px; left: -30px;  animation-delay: -1.8s; }
    .aurora-corner-br { bottom: -30px; right: -30px; animation-delay: -2.7s; }

    @keyframes aurora-h {
      0%   { transform: translateX(-55%); opacity: 0.5; }
      50%  { opacity: 1; }
      100% { transform: translateX(55%);  opacity: 0.5; }
    }

    @keyframes aurora-v {
      0%   { transform: translateY(-55%); opacity: 0.4; }
      50%  { opacity: 0.9; }
      100% { transform: translateY(55%);  opacity: 0.4; }
    }

    @keyframes corner-breathe {
      0%, 100% { opacity: 0.3; transform: scale(0.9); }
      50%       { opacity: 1;   transform: scale(1.1); }
    }

    .logo-center {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      animation: logo-rise 0.65s cubic-bezier(0.22, 1, 0.36, 1) both;
      animation-delay: 0.15s;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }

    .privsight-shell.interactive .logo-center {
      opacity: 0;
    }

    @keyframes logo-rise {
      from { opacity: 0; transform: translate(-50%, calc(-50% + 12px)); }
      to   { opacity: 1; transform: translate(-50%, -50%); }
    }

    .logo-halo {
      position: relative;
      width: 76px;
      height: 76px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .logo-halo::before {
      content: '';
      position: absolute;
      inset: -24px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.25) 0%, transparent 72%);
      animation: halo-pulse 2.2s ease-in-out infinite;
    }

    .logo-halo::after {
      content: '';
      position: absolute;
      inset: -12px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.15) 0%, transparent 70%);
      animation: halo-pulse 2.2s ease-in-out infinite;
      animation-delay: 0.5s;
    }

    @keyframes halo-pulse {
      0%, 100% { opacity: 0.5; transform: scale(0.95); }
      50%       { opacity: 1;   transform: scale(1.05); }
    }

    .logo-icon-wrap {
      width: 66px;
      height: 66px;
      border-radius: 18px;
      background: rgba(10, 12, 18, 0.82);
      border: 1.5px solid rgba(56, 189, 248, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      z-index: 1;
      box-shadow:
        0 0 0 1px rgba(56, 189, 248, 0.14),
        0 8px 32px rgba(0, 0, 0, 0.6),
        0 0 24px rgba(56, 189, 248, 0.20),
        inset 0 1px 0 rgba(56, 189, 248, 0.20);
      animation: icon-pulse 2.2s ease-in-out infinite;
    }

    @keyframes icon-pulse {
      0%, 100% { box-shadow: 0 0 0 1px rgba(56,189,248,0.14), 0 8px 32px rgba(0,0,0,0.6), 0 0 24px rgba(56,189,248,0.14); }
      50%       { box-shadow: 0 0 0 1px rgba(56,189,248,0.35), 0 8px 32px rgba(0,0,0,0.6), 0 0 38px rgba(56,189,248,0.30); }
    }

    .logo-label {
      font-size: 14px;
      font-weight: 600;
      color: rgba(186, 230, 253, 0.95);
      letter-spacing: 0.16em;
      text-transform: uppercase;
      animation: label-breathe 2.4s ease-in-out infinite;
      text-shadow: 0 0 16px rgba(56, 189, 248, 0.7);
    }

    @keyframes label-breathe {
      0%, 100% { opacity: 0.55; }
      50%       { opacity: 1; }
    }

    .dot-1, .dot-2, .dot-3 {
      display: inline-block;
      animation: dot-blink 1.4s ease-in-out infinite;
    }
    .dot-2 { animation-delay: 0.2s; }
    .dot-3 { animation-delay: 0.4s; }

    @keyframes dot-blink {
      0%, 100% { opacity: 0.2; }
      50%       { opacity: 1;   }
    }

    .privsight-shell.leaving {
      animation: overlay-out 0.4s ease-in both;
      pointer-events: none !important;
    }

    @keyframes overlay-out {
      from { opacity: 1; }
      to   { opacity: 0; }
    }
  `;

  // ─── Build & Inject Aurora Overlay ─────────────────────────────
  function createOverlay() {
    const stale = document.getElementById('privsight-overlay');
    if (stale) stale.remove();

    if (isActive) return;
    isActive = true;

    const host = document.createElement('div');
    host.id = 'privsight-overlay';
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      width: '100vw',
      height: '100vh',
      margin: '0',
      padding: '0',
      zIndex: '2147483647',
      pointerEvents: 'all',
      overflow: 'hidden',
      display: 'block',
    });

    const shadow = host.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = OVERLAY_CSS;
    shadow.appendChild(styleEl);

    const shell = document.createElement('div');
    shell.className = 'privsight-shell';

    const veil = document.createElement('div');
    veil.className = 'veil';
    shell.appendChild(veil);

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

    const logoCenter = document.createElement('div');
    logoCenter.className = 'logo-center';
    logoCenter.innerHTML = `
      <div class="logo-halo">
        <div class="logo-icon-wrap">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(56,189,248,0.95)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3.5 20V6C3.5 3.2 6.8 2.5 13.5 2.5L15 3.8L13 7.8"/>
            <path d="M3.5 15.5L7 18L3.5 20"/>
            <path d="M7 12.5C9 8.2 14 7.2 21 12.5C14 17.8 9 16.8 7 12.5Z"/>
            <circle cx="13.5" cy="12.5" r="3"/>
            <line x1="10.5" y1="18.5" x2="16" y2="6.5"/>
          </svg>
        </div>
      </div>
      <span class="logo-label">
        Working<span class="dot-1">.</span><span class="dot-2">.</span><span class="dot-3">.</span>
      </span>
    `;
    shell.appendChild(logoCenter);
    shadow.appendChild(shell);

    (document.documentElement || document.body).appendChild(host);
    overlayRoot = { host, shell };
  }

  function setOverlayInteractive(allowUserInteraction) {
    if (!overlayRoot) return;
    if (allowUserInteraction) {
      overlayRoot.shell.classList.add('interactive');
      overlayRoot.host.style.pointerEvents = 'none';
    } else {
      overlayRoot.shell.classList.remove('interactive');
      overlayRoot.host.style.pointerEvents = 'all';
    }
  }

  function removeOverlay(immediate = false) {
    if (!overlayRoot) return;
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

      // JSON-like representation for LLM payload (only data_hint and tag for viewport elements)
      sanitizedDom.push({
        data_hint: hint,
        tag: el.tagName ? el.tagName.toLowerCase() : 'div',
      });
    });

    (document.documentElement || document.body).appendChild(hintContainer);

    let screenshotB64 = '';
    try {
      // 4. Capture screenshot using built-in browser screen capture (chrome.tabs.captureVisibleTab)
      const overlayHost = overlayRoot?.host;
      const prevOverlayDisplay = overlayHost ? overlayHost.style.display : null;
      if (overlayHost) {
        overlayHost.style.display = 'none';
      }

      // Allow browser to render badges and hide overlay before screen capture
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 40)));

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
        // Immediately restore overlay veil
        if (overlayHost) {
          overlayHost.style.display = prevOverlayDisplay || 'block';
        }
      }

      if (capturedDataUrl) {
        let processedDataUrl = capturedDataUrl;

        // 5. Face redaction pass on screenshot using YuNet ONNX
        if (typeof window.faceRedaction === 'function') {
          try {
            processedDataUrl = await window.faceRedaction(capturedDataUrl);
          } catch (e) {
            console.warn('[PrivSight] Face redaction pass warning:', e);
          }
        }

        screenshotB64 = processedDataUrl.replace(/^data:image\/[a-zA-Z+.-]+;base64,/, '');
      }
    } catch (err) {
      console.warn('[PrivSight] Screenshot capture warning:', err);
    } finally {
      // 6. Remove number badges from UI, but KEEP data-hint in live DOM
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

      default:
        console.warn(`[PrivSight Executor] Unhandled action type: ${type}`);
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
      clearTimeout(agentTimer);
      agentTimer = setTimeout(() => {
        removeOverlay();
      }, 90_000);
      sendResponse({ ok: true, status: 'overlay_active' });
      return true;
    }

    if (message.type === 'STOP_AGENT') {
      clearTimeout(agentTimer);
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

  window.addEventListener('pagehide', () => {
    clearTimeout(agentTimer);
    if (overlayRoot && overlayRoot.host.parentNode) {
      overlayRoot.host.parentNode.removeChild(overlayRoot.host);
    }
    overlayRoot = null;
    isActive = false;
  });

  console.log('[PrivSight] Unified content agent initialized.');
})();

