/*
 * Profile editor. Reads/writes chrome.storage.local only. The saved profile
 * (built-in fields + any custom keys) is the single source of truth for both
 * autofill (pii-autofill.js) and redaction (agent.js → redactor.js); both
 * pick up changes live via storage.onChanged.
 */
(() => {
  'use strict';

  const SCHEMA = globalThis.PrivSightPIISchema;
  const KEYS = SCHEMA.storageKeys;
  const $ = (id) => document.getElementById(id);

  let settings = { ...SCHEMA.defaultSettings };

  // Site passed by the side panel (?site=https://example.com). Accept only
  // plain http(s) origins so the toggle can't be pointed at anything odd.
  const site = (() => {
    try {
      const raw = new URLSearchParams(location.search).get('site');
      const url = new URL(raw);
      return /^https?:$/.test(url.protocol) && url.origin === raw ? raw : null;
    } catch (_) {
      return null;
    }
  })();

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(items) {
    return new Promise((resolve) => chrome.storage.local.set(items, resolve));
  }

  function showStatus(text) {
    $('pf-status').textContent = text;
    clearTimeout(showStatus.timer);
    showStatus.timer = setTimeout(() => { $('pf-status').textContent = ''; }, 3000);
  }

  function renderForm(profile) {
    const container = $('pf-groups');
    container.textContent = '';

    for (const group of SCHEMA.groups) {
      const section = document.createElement('section');
      section.className = 'pf-group';

      const heading = document.createElement('h2');
      heading.textContent = group.title;
      if (group.sensitive) {
        const badge = document.createElement('span');
        badge.className = 'pf-badge';
        badge.textContent = 'Allowed sites only';
        heading.appendChild(badge);
      }
      section.appendChild(heading);

      const fields = document.createElement('div');
      fields.className = 'pf-fields';

      for (const [key, label, type = 'text'] of group.fields) {
        const wrap = document.createElement('div');
        wrap.className = type === 'textarea' ? 'pf-field pf-field--wide' : 'pf-field';

        const labelEl = document.createElement('label');
        labelEl.htmlFor = `pf-${key}`;
        labelEl.textContent = label;

        const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
        if (type !== 'textarea') input.type = type;
        input.id = `pf-${key}`;
        input.name = key;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.value = typeof profile[key] === 'string' ? profile[key] : '';

        wrap.append(labelEl, input);
        fields.appendChild(wrap);
      }

      section.appendChild(fields);
      container.appendChild(section);
    }
  }

  // ── Custom key/value fields ──────────────────────────────────
  // Stored flat in the same profile object as the built-in fields, so autofill
  // and redaction pick them up with no code changes.
  const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  function addCustomRow(key = '', value = '') {
    const row = document.createElement('div');
    row.className = 'pf-custom-row';

    // No `name` attributes: these are collected separately from the fixed fields
    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.placeholder = 'Field name (e.g. libraryCard)';
    keyInput.setAttribute('aria-label', 'Custom field name');
    keyInput.maxLength = 40;
    keyInput.autocomplete = 'off';
    keyInput.spellcheck = false;
    keyInput.value = key;

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.placeholder = 'Value';
    valueInput.setAttribute('aria-label', 'Custom field value');
    valueInput.autocomplete = 'off';
    valueInput.spellcheck = false;
    valueInput.value = value;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'pf-btn pf-btn--small';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => row.remove());

    row.append(keyInput, valueInput, remove);
    $('pf-custom').appendChild(row);
    return keyInput;
  }

  function renderCustom(profile) {
    $('pf-custom').textContent = '';
    for (const [key, value] of Object.entries(profile)) {
      if (SCHEMA.isCustomKey(key) && typeof value === 'string') addCustomRow(key, value);
    }
  }

  /** Reads custom rows into `next`; returns an error message or '' when valid. */
  function collectCustom(next) {
    const seen = new Set();
    for (const row of $('pf-custom').querySelectorAll('.pf-custom-row')) {
      const [keyInput, valueInput] = row.querySelectorAll('input');
      const key = keyInput.value.trim();
      const value = valueInput.value.trim();
      keyInput.removeAttribute('aria-invalid');
      if (!key && !value) continue;

      let error = '';
      if (!key) error = 'Give every custom value a field name.';
      else if (key.length < 2 || RESERVED_KEYS.has(key)) error = `"${key}" can't be used as a field name.`;
      else if (!SCHEMA.isCustomKey(key)) error = `"${key}" is a built-in field — fill it in above instead.`;
      else if (seen.has(key)) error = `"${key}" is listed twice.`;
      if (error) {
        keyInput.setAttribute('aria-invalid', 'true');
        keyInput.focus();
        return error;
      }
      seen.add(key);
      if (value) next[key] = value;
    }
    return '';
  }

  function renderSettings() {
    $('pf-enabled').checked = settings.enabled;

    const list = $('pf-sites');
    list.textContent = '';
    for (const origin of settings.sensitiveSites) {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = origin;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'pf-btn pf-btn--small';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => setSiteAllowed(origin, false));
      item.append(name, remove);
      list.appendChild(item);
    }
    $('pf-sites-empty').hidden = settings.sensitiveSites.length > 0;

    if (site) {
      $('pf-site').hidden = false;
      $('pf-site-name').textContent = site;
      $('pf-site-toggle').checked = settings.sensitiveSites.includes(site);
    }
  }

  async function saveSettings() {
    await storageSet({ [KEYS.settings]: settings });
    renderSettings();
  }

  async function setSiteAllowed(origin, allowed) {
    const others = settings.sensitiveSites.filter((entry) => entry !== origin);
    settings = { ...settings, sensitiveSites: allowed ? [...others, origin] : others };
    await saveSettings();
    showStatus(allowed ? `Allowed on ${origin}` : `Removed ${origin}`);
  }

  async function init() {
    const items = await storageGet([KEYS.profile, KEYS.settings]);
    const profile = items[KEYS.profile] && typeof items[KEYS.profile] === 'object' ? items[KEYS.profile] : {};
    const stored = items[KEYS.settings] || {};
    settings = {
      enabled: stored.enabled !== false,
      sensitiveSites: Array.isArray(stored.sensitiveSites) ? stored.sensitiveSites : [],
    };

    renderForm(profile);
    renderCustom(profile);
    renderSettings();

    $('pf-custom-add').addEventListener('click', () => addCustomRow().focus());

    $('pf-enabled').addEventListener('change', async (event) => {
      settings = { ...settings, enabled: event.target.checked };
      await saveSettings();
      showStatus(settings.enabled ? 'Autofill on' : 'Autofill off');
    });

    $('pf-site-toggle').addEventListener('change', (event) => {
      if (site) setSiteAllowed(site, event.target.checked);
    });

    $('pf-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const next = {};
      for (const [key, value] of new FormData(event.target)) {
        const trimmed = String(value).trim();
        if (trimmed) next[key] = trimmed;
      }
      const error = collectCustom(next);
      if (error) {
        showStatus(error);
        return;
      }
      await storageSet({ [KEYS.profile]: next });
      showStatus('Profile saved');
    });

    $('pf-clear').addEventListener('click', async () => {
      if (!confirm('Delete all saved profile details from this browser?')) return;
      await new Promise((resolve) => chrome.storage.local.remove(KEYS.profile, resolve));
      renderForm({});
      renderCustom({});
      showStatus('Profile cleared');
    });
  }

  init();
})();
