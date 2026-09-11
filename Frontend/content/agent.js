/**
 * PrivSight — Content Script (agent.js)
 *
 * Injected into every webpage the user visits.
 *
 * Responsibilities:
 *  1. Listen for START_AGENT / STOP_AGENT messages from popup.js.
 *  2. Inject a minimal, premium in-page overlay when the agent is active:
 *     - Thin electric-blue Aurora flowing around the viewport edges.
 *     - PrivSight shield logo centered with a soft glow/pulse.
 *     - Very subtle dark transparent overlay that locks the page without obscuring it.
 *  3. Remove the overlay and restore interactivity when the agent completes.
 *
 * The overlay is fully self-contained inside a Shadow DOM so it never
 * interferes with the host page's own CSS or JavaScript.
 *
 * HOW IT WORKS (for interviews):
 *  - When the popup sends { type: "START_AGENT" }, agent.js creates a
 *    <div id="privsight-overlay"> attached to <html>.
 *  - Inside that div, a Shadow Root is opened so PrivSight's CSS is
 *    perfectly isolated from the page's styles.
 *  - The host div uses inline styles (position:fixed, inset:0) so it
 *    reliably covers the viewport regardless of what the page's CSS does.
 *  - pointer-events: all on the shell absorbs every click before it
 *    reaches the page beneath, making the page non-interactive.
 *  - When { type: "STOP_AGENT" } arrives (or after a timeout), the
 *    overlay fades out and is removed, restoring full page interactivity.
 */

(function () {
  'use strict';

  if (window.__PRIVSIGHT_AGENT_INJECTED__) {
    return;
  }
  window.__PRIVSIGHT_AGENT_INJECTED__ = true;

  // ─── State ─────────────────────────────────────────────
  let overlayRoot = null;
  let agentTimer  = null;
  let isActive    = false;

  // ─── Styles (injected into Shadow DOM) ─────────────────
  const OVERLAY_CSS = `
    /* privsight-shell fills the host element which is already fixed */
    .privsight-shell {
      position: absolute;
      inset: 0;
      pointer-events: all;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
    }

    /* ── Subtle dark veil ──────────────────────────────── */
    .veil {
      position: absolute;
      inset: 0;
      background: rgba(4, 4, 10, 0.28);
      backdrop-filter: blur(0.5px);
      -webkit-backdrop-filter: blur(0.5px);
      animation: veil-in 0.55s ease-out both;
    }

    @keyframes veil-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* ── Aurora edges ──────────────────────────────────── */
    .aurora-edge {
      position: absolute;
      pointer-events: none;
      z-index: 10;
    }

    /* Top edge */
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

    /* Bottom edge */
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

    /* Left edge */
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

    /* Right edge */
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

    /* Corner glow accents */
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

    /* ── Centre logo ───────────────────────────────────── */
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

    /* ── Fade-out transition ───────────────────────────── */
    .privsight-shell.leaving {
      animation: overlay-out 0.4s ease-in both;
      pointer-events: none !important;
    }

    @keyframes overlay-out {
      from { opacity: 1; }
      to   { opacity: 0; }
    }
  `;

  // ─── Build & Inject Overlay ─────────────────────────────
  function createOverlay() {
    // Remove any stale overlay from a crashed previous run
    const stale = document.getElementById('privsight-overlay');
    if (stale) stale.remove();

    if (isActive) return;
    isActive = true;

    // ── Host element ────────────────────────────────────────
    // CRITICAL: inline styles are mandatory here.
    // :host CSS inside the Shadow DOM does NOT reliably set position/size
    // on all host pages — some pages apply CSS resets that override it.
    // Inline styles are the highest specificity and cannot be overridden
    // by any external stylesheet.
    const host = document.createElement('div');
    host.id = 'privsight-overlay';
    host.setAttribute('aria-hidden', 'true');
    Object.assign(host.style, {
      position:      'fixed',
      top:           '0',
      left:          '0',
      right:         '0',
      bottom:        '0',
      width:         '100vw',
      height:        '100vh',
      margin:        '0',
      padding:       '0',
      zIndex:        '2147483647',
      pointerEvents: 'all',
      overflow:      'hidden',
      display:       'block',
    });

    // ── Shadow DOM ──────────────────────────────────────────
    // Attach shadow root — every style inside here is 100% isolated
    // from the host page. The page cannot see our styles and we cannot
    // accidentally inherit theirs.
    const shadow = host.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = OVERLAY_CSS;
    shadow.appendChild(styleEl);

    // ── Shell div ───────────────────────────────────────────
    const shell = document.createElement('div');
    shell.className = 'privsight-shell';

    // Veil — subtle dark lock
    const veil = document.createElement('div');
    veil.className = 'veil';
    shell.appendChild(veil);

    // Aurora edge bars
    ['aurora-edge aurora-top', 'aurora-edge aurora-bottom',
     'aurora-edge aurora-left', 'aurora-edge aurora-right'].forEach(cls => {
      const el = document.createElement('div');
      el.className = cls;
      shell.appendChild(el);
    });

    // Corner glow accents
    ['aurora-corner aurora-corner-tl', 'aurora-corner aurora-corner-tr',
     'aurora-corner aurora-corner-bl', 'aurora-corner aurora-corner-br'].forEach(cls => {
      const el = document.createElement('div');
      el.className = cls;
      shell.appendChild(el);
    });

    // Centred logo
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

    // Append to <html> not <body> — more reliable when the page's <body>
    // has overflow:hidden, transform, or will-change (which create new
    // stacking contexts that defeat position:fixed on child elements).
    (document.documentElement || document.body).appendChild(host);
    overlayRoot = { host, shell };

    console.log('[PrivSight] Overlay active — page locked while agent works.');
  }

  // ─── Remove Overlay (with fade-out) ────────────────────
  function removeOverlay(immediate = false) {
    if (!overlayRoot) return;

    const { host, shell } = overlayRoot;
    isActive = false;

    if (immediate) {
      if (host.parentNode) host.parentNode.removeChild(host);
      overlayRoot = null;
      console.log('[PrivSight] Overlay removed immediately.');
      return;
    }

    // Trigger the fade-out CSS animation first
    shell.classList.add('leaving');

    // Remove from DOM once animation finishes
    setTimeout(() => {
      if (host.parentNode) host.parentNode.removeChild(host);
      overlayRoot = null;
      console.log('[PrivSight] Overlay removed — page restored.');
    }, 420);
  }

  // ─── Message Handler ────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

    if (message.type === 'START_AGENT') {
      console.log('[PrivSight] Agent started — Task:', message.prompt);
      createOverlay();

      // Safety timeout: auto-remove after 35s even if popup never sends STOP_AGENT
      clearTimeout(agentTimer);
      agentTimer = setTimeout(() => {
        console.warn('[PrivSight] Safety timeout — removing overlay after 35s.');
        removeOverlay();
      }, 35_000);

      sendResponse({ ok: true, status: 'overlay_active' });
    }

    if (message.type === 'STOP_AGENT') {
      console.log('[PrivSight] Agent stopped.');
      clearTimeout(agentTimer);
      removeOverlay(message.immediate || false);
      sendResponse({ ok: true, status: 'overlay_removed' });
    }

    return true; // keep message channel open for async sendResponse
  });

  // ─── Cleanup on page navigation ─────────────────────────
  window.addEventListener('pagehide', () => {
    clearTimeout(agentTimer);
    if (overlayRoot && overlayRoot.host.parentNode) {
      overlayRoot.host.parentNode.removeChild(overlayRoot.host);
    }
    overlayRoot = null;
    isActive    = false;
  });

})();
