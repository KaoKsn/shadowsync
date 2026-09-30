/*
 * PrivSight — text-box PII guard.
 *
 * While the user types or pastes into a multi-line text box (textarea or a
 * rich editor such as ChatGPT / Gemini / Claude prompt boxes), finds personal
 * data and shows a badge with the count. Clicking it opens a list of findings
 * (masked) where the user can replace them with placeholders like
 * [EMAIL_REDACTED] before sending.
 *
 * Detection runs entirely on-device: the extension's offscreen PII engine
 * (rules + checksums + NER, via PII_ANALYZE), exact matches of the user's own
 * saved profile values, and redactor.js's regex rules as a fallback. Nothing
 * is sent anywhere and no values are logged.
 *
 * Single-line inputs are ignored on purpose: typing your email into an
 * "Email" field is intended, not a leak.
 */
(() => {
  'use strict';

  // Re-injection safe (see agent.js): tear down a previous instance first.
  if (typeof window.__PRIVSIGHT_GUARD_CLEANUP__ === 'function') {
    try { window.__PRIVSIGHT_GUARD_CLEANUP__(); } catch (_) {}
  }

  const SCHEMA = globalThis.PrivSightPIISchema;
  const Redactor = globalThis.DOMRedactor;
  if (!SCHEMA || !chrome.runtime?.id) return;

  const GUARD_KEY = SCHEMA.storageKeys.guard;
  const DEBOUNCE_MS = 600;
  const ENGINE_TIMEOUT_MS = 2500;
  const MAX_TEXT = 6000;
  const MIN_TEXT = 6;

  let enabled = true;
  let profileMatcher = null;
  let field = null;                // the text box being watched
  let findings = [];               // [{ id, type, label, token, text, checked }]
  let scanSeq = 0;
  let debounceTimer = null;
  let panelOpen = false;
  const cleanups = [];

  // ── Field helpers ─────────────────────────────────────────────────────────
  function editableRoot(node) {
    const el = node instanceof Element ? node : node?.parentElement;
    if (!el) return null;
    if (el.closest('#privsight-guard-host, #privsight-overlay, #privsight-hint-container')) return null;
    if (el instanceof HTMLTextAreaElement) return el.disabled || el.readOnly ? null : el;
    const rich = el.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"][contenteditable]');
    return rich && rich.isContentEditable ? rich : null;
  }

  const isTextControl = (el) => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
  const fieldText = (el) => (isTextControl(el) ? el.value : el.innerText || '');

  // ── Detection ─────────────────────────────────────────────────────────────
  const TYPE_LABELS = {
    EMAIL: 'Email', PHONE: 'Phone', ADDRESS: 'Address', NAME: 'Name', IDENTIFIER: 'ID number',
    AADHAAR: 'Aadhaar', AADHAAR_VID: 'Aadhaar VID', PAN: 'PAN', PASSPORT: 'Passport', VOTER_ID: 'Voter ID',
    DRIVER_LICENSE: 'Driving licence', CREDIT_CARD: 'Card number', BANK_ACCOUNT: 'Bank account',
    IFSC: 'IFSC', UPI: 'UPI ID', DOB: 'Date of birth', PINCODE: 'PIN code', SSN: 'SSN',
    API_KEY: 'API key', AUTH_TOKEN: 'Auth token', JWT: 'Token', PASSWORD: 'Password',
    IP_ADDRESS: 'IP address', GSTIN: 'GSTIN', MEDICAL_CONDITION: 'Medical info', BLOOD_GROUP: 'Blood group',
  };
  const TOKEN_NAMES = { IDENTIFIER: 'ID' };

  const titleCase = (s) => s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const labelOf = (type) => TYPE_LABELS[type] || titleCase(type);
  const tokenOf = (type) => `[${TOKEN_NAMES[type] || type}_REDACTED]`;

  /** Engine spans can run past a blank line into the next label ("…India\n\nGovernment ID"). */
  function cleanEntityText(text) {
    return String(text || '')
      .split(/\n\s*\n/)[0]
      .replace(/^[\s,;:.]+|[\s,;:.]+$/g, '');
  }

  function askEngine(text) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ENGINE_TIMEOUT_MS);
      try {
        chrome.runtime.sendMessage({ type: 'PII_ANALYZE', texts: [text] }, (resp) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError || !resp?.ok) return resolve(null);
          resolve((resp.entities && resp.entities[0]) || []);
        });
      } catch (_) {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  function profileFindings(text) {
    const out = [];
    if (!profileMatcher) return out;
    for (const [re, keys] of [[profileMatcher.value, profileMatcher.valueKeys], [profileMatcher.word, profileMatcher.wordKeys]]) {
      if (!re) continue;
      for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
        const key = keys[m.slice(1).findIndex((g) => g !== undefined)];
        if (!key) continue;
        const name = SCHEMA.keyToLabel(key);
        out.push({
          type: name.toUpperCase().replace(/\s+/g, '_'),
          label: `${name.charAt(0).toUpperCase()}${name.slice(1)} (your profile)`,
          text: m[0],
        });
      }
    }
    return out;
  }

  async function detect(text) {
    const engine = await askEngine(text);
    const raw = [
      ...profileFindings(text),
      ...(engine || []).map((e) => ({ type: e.type, text: cleanEntityText(e.text) })),
      // Regex rules only when the engine is unavailable (it already includes them)
      ...(engine ? [] : (Redactor?.findPII?.(text) || [])),
    ];

    const seen = new Set();
    const list = [];
    for (const f of raw) {
      const value = (f.text || '').trim();
      if (value.length < 3 || /_REDACTED\]/.test(value) || !text.includes(value)) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ type: f.type, label: f.label || labelOf(f.type), token: tokenOf(f.type), text: value });
    }
    // Drop findings contained in a longer one ("Rahul" inside "Rahul Sharma")
    return list.filter((f) => !list.some((o) => o !== f && o.text.length > f.text.length && o.text.includes(f.text)));
  }

  function mask(value) {
    const v = value.replace(/\s+/g, ' ');
    if (v.length <= 4) return '*'.repeat(v.length);
    return `${v.slice(0, 2)}${'*'.repeat(Math.min(v.length - 4, 12))}${v.slice(-2)}`;
  }

  // ── Replacement ───────────────────────────────────────────────────────────
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const valuePattern = (value) => new RegExp(escapeRe(value).replace(/\s+/g, '\\s+'));

  /** Map a rich editor's text nodes to one string (block breaks as "\n"). */
  function textMap(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const segments = [];
    let text = '';
    let lastBlock = null;
    const blockOf = (node) => {
      let el = node.parentElement;
      while (el && el !== root && getComputedStyle(el).display.startsWith('inline')) el = el.parentElement;
      return el;
    };
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const block = blockOf(node);
      if (lastBlock && block !== lastBlock) text += '\n';
      lastBlock = block;
      segments.push({ node, start: text.length, end: text.length + node.nodeValue.length });
      text += node.nodeValue;
    }
    return { text, segments };
  }

  function rangeFor(map, start, end) {
    const at = (pos, preferEnd) => {
      for (const s of map.segments) {
        if (pos >= s.start && (preferEnd ? pos <= s.end : pos < s.end)) return { node: s.node, offset: pos - s.start };
      }
      return null;
    };
    const a = at(start, false);
    const b = at(end, true);
    if (!a || !b) return null;
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    return range;
  }

  /** Replace the first occurrence of `value`; returns false when there is none. */
  function replaceOnce(el, value, token) {
    const pattern = valuePattern(value);
    if (isTextControl(el)) {
      const m = pattern.exec(el.value);
      if (!m) return false;
      const before = el.value;
      el.focus();
      el.setSelectionRange(m.index, m.index + m[0].length);
      // execCommand keeps undo history and fires the events frameworks listen for
      const done = document.execCommand?.('insertText', false, token);
      if (!done || el.value === before) {
        el.setRangeText(token, m.index, m.index + m[0].length, 'end');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: token }));
      }
      return el.value !== before;
    }

    const map = textMap(el);
    const m = pattern.exec(map.text);
    if (!m) return false;
    const range = rangeFor(map, m.index, m.index + m[0].length);
    if (!range) return false;
    const before = el.innerText;
    el.focus();
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const done = document.execCommand?.('insertText', false, token);
    if (!done || el.innerText === before) {
      range.deleteContents();
      range.insertNode(document.createTextNode(token));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: token }));
    }
    return el.innerText !== before;
  }

  function redact(selected) {
    if (!field || !field.isConnected) return 0;
    let count = 0;
    // Longest first, so "123 MG Road, Bengaluru" goes before any part of it
    for (const f of [...selected].sort((a, b) => b.text.length - a.text.length)) {
      for (let guard = 0; guard < 50 && replaceOnce(field, f.text, f.token); guard += 1) count += 1;
    }
    return count;
  }

  // ── UI (shadow DOM, isolated from page styles) ────────────────────────────
  const host = document.createElement('div');
  host.id = 'privsight-guard-host';
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483645;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .badge {
        position: fixed; width: 30px; height: 30px; border-radius: 50%;
        display: none; place-items: center; cursor: pointer; padding: 0;
        background: #fff; border: 1px solid rgba(0,0,0,.12);
        box-shadow: 0 2px 8px rgba(0,0,0,.25); transition: transform .15s, opacity .2s;
      }
      .badge:hover { transform: scale(1.08); }
      .badge img { width: 20px; height: 20px; }
      .badge.clear { opacity: .55; }
      .count {
        position: absolute; top: -6px; right: -6px; min-width: 17px; height: 17px; padding: 0 4px;
        border-radius: 9px; background: #dc2626; color: #fff; font-size: 10.5px; font-weight: 700;
        display: grid; place-items: center; border: 2px solid #fff;
      }
      .badge.clear .count { display: none; }
      .panel {
        position: fixed; width: 260px; display: none; border-radius: 12px; overflow: hidden;
        background: #ffffff; color: #111827; border: 1px solid rgba(0,0,0,.12);
        box-shadow: 0 16px 40px -8px rgba(0,0,0,.35); font-size: 13px;
      }
      .head { display: flex; align-items: center; justify-content: space-between; padding: 11px 12px; font-weight: 650; border-bottom: 1px solid rgba(0,0,0,.08); }
      .head button { border: 0; background: none; font-size: 17px; line-height: 1; cursor: pointer; color: #6b7280; padding: 2px 4px; border-radius: 6px; }
      .head button:hover { background: rgba(0,0,0,.06); color: #111827; }
      .list { max-height: 220px; overflow: auto; padding: 6px 0; }
      .row { display: flex; gap: 10px; align-items: flex-start; padding: 7px 12px; cursor: pointer; }
      .row:hover { background: rgba(0,0,0,.04); }
      .row input { margin-top: 3px; accent-color: #0284c7; }
      .type { font-size: 10.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: #6b7280; }
      .value { font-family: ui-monospace, Consolas, monospace; font-size: 12.5px; word-break: break-all; }
      .foot { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid rgba(0,0,0,.08); }
      .foot button { flex: 1; height: 32px; border-radius: 8px; font-size: 12.5px; font-weight: 600; cursor: pointer; border: 1px solid rgba(0,0,0,.14); }
      .sel { background: #f3f4f6; color: #111827; }
      .all { background: #0f172a; color: #fff; border-color: #0f172a; }
      .foot button:disabled { opacity: .45; cursor: default; }
      .note { padding: 0 12px 10px; font-size: 11px; color: #6b7280; }
      @media (prefers-color-scheme: dark) {
        .badge { background: #1f2937; border-color: rgba(255,255,255,.14); }
        .count { border-color: #1f2937; }
        .panel { background: #111827; color: #f3f4f6; border-color: rgba(255,255,255,.12); }
        .head, .foot { border-color: rgba(255,255,255,.08); }
        .head button { color: #9ca3af; } .head button:hover { background: rgba(255,255,255,.08); color: #f3f4f6; }
        .row:hover { background: rgba(255,255,255,.05); }
        .type, .note { color: #9ca3af; }
        .sel { background: #1f2937; color: #f3f4f6; border-color: rgba(255,255,255,.14); }
        .all { background: #38bdf8; color: #04121c; border-color: #38bdf8; }
      }
    </style>
    <button class="badge" type="button" title="PrivSight: personal data found">
      <img alt="PrivSight"><span class="count"></span>
    </button>
    <div class="panel" role="dialog" aria-label="Personal data detected">
      <div class="head"><span>PII Detected</span><button type="button" class="close" aria-label="Close">×</button></div>
      <div class="list"></div>
      <div class="note">Checked locally. Nothing has been sent.</div>
      <div class="foot">
        <button type="button" class="sel">Redact Selected</button>
        <button type="button" class="all">Redact All</button>
      </div>
    </div>`;

  const ui = {
    badge: shadow.querySelector('.badge'),
    count: shadow.querySelector('.count'),
    panel: shadow.querySelector('.panel'),
    list: shadow.querySelector('.list'),
    close: shadow.querySelector('.close'),
    sel: shadow.querySelector('.sel'),
    all: shadow.querySelector('.all'),
  };
  ui.badge.querySelector('img').src = chrome.runtime.getURL('icons/icon48.png');

  function position() {
    if (!field || !field.isConnected) return hide();
    const r = field.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) {
      ui.badge.style.display = 'none';
      ui.panel.style.display = 'none';
      return;
    }
    const size = 30;
    const top = r.height < 64 ? r.top + (r.height - size) / 2 : r.bottom - size - 8;
    const left = Math.min(r.right - size - 8, innerWidth - size - 4);
    ui.badge.style.top = `${Math.max(4, top)}px`;
    ui.badge.style.left = `${Math.max(4, left)}px`;
    ui.badge.style.display = 'grid';
    if (panelOpen) {
      const width = 260;
      const panelHeight = ui.panel.offsetHeight || 220;
      const px = Math.max(8, Math.min(left + size - width, innerWidth - width - 8));
      const above = top - panelHeight - 8;
      ui.panel.style.left = `${px}px`;
      ui.panel.style.top = `${above > 8 ? above : Math.min(top + size + 8, innerHeight - panelHeight - 8)}px`;
      ui.panel.style.display = 'block';
    }
  }

  function renderPanel() {
    ui.list.replaceChildren(...findings.map((f) => {
      const row = document.createElement('label');
      row.className = 'row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = f.checked;
      box.addEventListener('change', () => { f.checked = box.checked; syncButtons(); });
      const info = document.createElement('div');
      const type = document.createElement('div');
      type.className = 'type';
      type.textContent = f.label;
      const value = document.createElement('div');
      value.className = 'value';
      value.textContent = mask(f.text);
      info.append(type, value);
      row.append(box, info);
      return row;
    }));
    syncButtons();
  }

  function syncButtons() {
    ui.sel.disabled = !findings.some((f) => f.checked);
    ui.all.disabled = findings.length === 0;
  }

  function render() {
    const n = findings.length;
    ui.count.textContent = n > 9 ? '9+' : String(n);
    ui.badge.classList.toggle('clear', n === 0);
    ui.badge.title = n ? `PrivSight: ${n} item${n === 1 ? '' : 's'} of personal data found — click to review`
      : 'PrivSight: no personal data found';
    if (panelOpen && n === 0) closePanel();
    if (panelOpen) renderPanel();
    position();
  }

  function openPanel() {
    if (!findings.length) return;
    panelOpen = true;
    renderPanel();
    position();
  }

  function closePanel() {
    panelOpen = false;
    ui.panel.style.display = 'none';
  }

  function hide() {
    closePanel();
    ui.badge.style.display = 'none';
  }

  function applyRedaction(selected) {
    if (!selected.length) return;
    redact(selected);
    closePanel();
    scheduleScan(0);
  }

  ui.badge.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the text box
  ui.badge.addEventListener('click', () => (panelOpen ? closePanel() : openPanel()));
  ui.close.addEventListener('click', closePanel);
  ui.sel.addEventListener('click', () => applyRedaction(findings.filter((f) => f.checked)));
  ui.all.addEventListener('click', () => applyRedaction(findings));
  ui.panel.addEventListener('mousedown', (e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); });

  // ── Scanning ──────────────────────────────────────────────────────────────
  async function scan() {
    if (!enabled || !field || !field.isConnected) return;
    const seq = ++scanSeq;
    const text = fieldText(field).slice(0, MAX_TEXT);
    if (text.trim().length < MIN_TEXT) {
      findings = [];
      render();
      if (!text.trim()) hide();
      return;
    }
    const found = await detect(text);
    if (seq !== scanSeq) return; // a newer scan superseded this one
    const previous = new Map(findings.map((f) => [f.text, f.checked]));
    findings = found.map((f, i) => ({ ...f, id: i, checked: previous.get(f.text) ?? true }));
    render();
  }

  function scheduleScan(delay = DEBOUNCE_MS) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scan, delay);
  }

  function watch(el) {
    if (field !== el) {
      field = el;
      findings = [];
      closePanel();
    }
  }

  // Only the user's own typing / pasting (trusted events). Text the agent
  // types or autofill fills arrives as untrusted events and is ignored.
  function onInput(event) {
    if (!enabled || !event.isTrusted) return;
    const el = editableRoot(event.target);
    if (!el) return;
    watch(el);
    scheduleScan();
  }

  function onFocus(event) {
    if (!enabled) return;
    const el = editableRoot(event.target);
    if (!el || !fieldText(el).trim()) return;
    watch(el);
    scheduleScan(0);
  }

  function onPointerDown(event) {
    if (panelOpen && !event.composedPath().includes(host)) closePanel();
  }

  let frame = 0;
  const reposition = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(position);
  };

  function listen(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  listen(document, 'input', onInput, true);
  listen(document, 'focusin', onFocus, true);
  listen(document, 'pointerdown', onPointerDown, true);
  listen(window, 'scroll', reposition, true);
  listen(window, 'resize', reposition);
  listen(document, 'keydown', (e) => { if (e.key === 'Escape' && panelOpen) closePanel(); }, true);

  // ── Settings + profile (same stored profile as autofill / redaction) ─────
  function applySettings(items) {
    enabled = items?.[GUARD_KEY]?.enabled !== false;
    const profile = items?.[SCHEMA.storageKeys.profile];
    profileMatcher = profile && Redactor?.compileProfile
      ? Redactor.compileProfile(profile, {
        skipKeys: SCHEMA.redactExemptKeys,
        nameKeys: Object.keys(profile).filter(SCHEMA.isNameKey),
      })
      : null;
    if (!enabled) hide();
    else if (field) scheduleScan(0);
  }

  const onStorage = (changes, area) => {
    if (area !== 'local' || !(GUARD_KEY in changes || SCHEMA.storageKeys.profile in changes)) return;
    chrome.storage.local.get([GUARD_KEY, SCHEMA.storageKeys.profile], applySettings);
  };
  chrome.storage.onChanged.addListener(onStorage);
  cleanups.push(() => chrome.storage.onChanged.removeListener(onStorage));
  chrome.storage.local.get([GUARD_KEY, SCHEMA.storageKeys.profile], applySettings);

  (document.documentElement || document.body).appendChild(host);

  window.__PRIVSIGHT_GUARD_CLEANUP__ = () => {
    cleanups.forEach((fn) => fn());
    clearTimeout(debounceTimer);
    host.remove();
  };
})();
