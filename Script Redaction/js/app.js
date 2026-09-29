import { PIIRedactor } from './redactor/index.js';
import { NerClient } from './redactor/ner-client.js';
import { formatTag } from './redactor/render.js';

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  // ============================================================
  // ENGINE + NER MODEL (runs in a Web Worker, loaded from ./models/)
  // ============================================================
  const ner = new NerClient();
  const redactor = new PIIRedactor().setNerBackend(ner);

  const styleSel = $('style');
  const sensitivitySel = $('sensitivity');
  const useNer = $('use-ner');
  const nerBadge = $('ner-status');

  const updateBadge = ({ status, backend, progress, error }) => {
    if (!useNer.checked) {
      nerBadge.textContent = 'NER: Off';
      nerBadge.className = 'ner-badge ner-loading';
      nerBadge.title = 'Regex + checksum + name gazetteer only';
      return;
    }
    const labels = {
      idle: ['NER: Idle', 'ner-loading'],
      loading: [`NER: Loading ${Math.round(progress * 100)}%`, 'ner-loading'],
      ready: [`NER: Active (${(backend || 'wasm').toUpperCase()})`, 'ner-active'],
      error: ['NER: Offline', 'ner-offline'],
    };
    const [text, cls] = labels[status];
    nerBadge.textContent = text;
    nerBadge.className = `ner-badge ${cls}`;
    nerBadge.title = error ? `${error}\nRun "npm run setup:ner" to download the model.` : '';
  };
  ner.onStatus(updateBadge);

  // ============================================================
  // ALLOW / DENY LISTS (kept in this browser only)
  // ============================================================
  const allowInput = $('allow-list');
  const denyInput = $('deny-list');
  const store = {
    get: (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };
  allowInput.value = store.get('pii.allow');
  denyInput.value = store.get('pii.deny');

  /** "/pattern/flags" -> RegExp, anything else -> plain string. Invalid regexes are ignored. */
  function parseTerm(s) {
    const m = /^\/(.+)\/([gimsuy]*)$/.exec(s);
    if (!m) return s;
    try { return new RegExp(m[1], m[2]); } catch (e) { return null; }
  }
  const lines = (el) => el.value.split('\n').map(l => l.trim()).filter(Boolean);
  const allowList = () => lines(allowInput).map(parseTerm).filter(Boolean);
  const denyList = () => lines(denyInput).map((line) => {
    const m = /^([A-Z][A-Z0-9_]{1,30}):\s*(.+)$/.exec(line);
    const value = parseTerm(m ? m[2] : line);
    return value ? { value, type: m ? m[1] : 'CUSTOM' } : null;
  }).filter(Boolean);

  const options = () => ({
    style: styleSel.value,
    sensitivity: sensitivitySel.value,
    allow: allowList(),
    deny: denyList(),
    ner: { enabled: useNer.checked && ner.status !== 'error' },
  });

  if (useNer.checked) ner.load().catch(() => {});

  // ============================================================
  // SHARED RENDERING
  // ============================================================
  function renderEntities(table, entities) {
    const tbody = table.querySelector('tbody');
    tbody.replaceChildren();
    for (const e of entities) {
      const tr = document.createElement('tr');
      const where = e.where && e.where !== 'text' ? ` (${e.where})` : '';
      for (const value of [e.type, e.text + where, e.score.toFixed(2), e.sources.join(' + '), (e.reasons || []).join('; ')]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.hidden = entities.length === 0;
  }

  function stats(el, result, ms) {
    const engine = result.nerUsed ? 'rules + NER' : 'rules only';
    el.textContent = `${result.entities.length} entities · ${ms.toFixed(0)} ms · ${engine}`;
  }

  /** Redacted text with each replacement wrapped in a hoverable <mark>. */
  function renderHighlighted(container, source, entities, style) {
    container.replaceChildren();
    let pos = 0;
    for (const e of [...entities].sort((a, b) => a.start - b.start)) {
      if (e.start > pos) container.appendChild(document.createTextNode(source.slice(pos, e.start)));
      const mark = document.createElement('mark');
      mark.className = 'pii';
      mark.dataset.type = e.type;
      mark.title = `${e.type} · score ${e.score.toFixed(2)} · ${e.sources.join(' + ')}\n- ${(e.reasons || []).join('\n- ')}`;
      mark.textContent = formatTag(e.type, style, e.text);
      container.appendChild(mark);
      pos = e.end;
    }
    if (pos < source.length) container.appendChild(document.createTextNode(source.slice(pos)));
  }

  // ============================================================
  // SECTION 1: TEXT REDACTION
  // ============================================================
  const textInput = $('text-input');
  const textOutput = $('text-output');
  let lastTextOutput = '';

  async function runTextRedaction() {
    const raw = textInput.value;
    if (!raw) {
      textOutput.replaceChildren();
      $('text-stats').textContent = '';
      renderEntities($('text-entities'), []);
      return;
    }
    const opts = options();
    const t0 = performance.now();
    const result = await redactor.redactTextAsync(raw, opts);
    lastTextOutput = result.output;
    renderHighlighted(textOutput, raw, result.entities, opts.style);
    renderEntities($('text-entities'), result.entities);
    stats($('text-stats'), result, performance.now() - t0);
  }

  $('btn-redact-text').addEventListener('click', runTextRedaction);
  $('btn-copy-text').addEventListener('click', () => {
    if (lastTextOutput) navigator.clipboard.writeText(lastTextOutput).catch(() => {});
  });

  // ============================================================
  // SECTION 2: HTML FILE REDACTION
  // ============================================================
  const origIframe = $('orig-iframe');
  const redactedIframe = $('redacted-iframe');
  const origCode = $('orig-code');
  const redactedCode = $('redacted-code');
  const btnDownloadHtml = $('btn-download-html');

  let currentRawHtml = '';
  let currentRedactedHtml = '';
  let uploadedFileName = 'redacted.html';

  async function processHtmlFile() {
    if (!currentRawHtml) return;
    origIframe.srcdoc = currentRawHtml;
    origCode.value = currentRawHtml;

    const t0 = performance.now();
    const result = await redactor.redactHTMLAsync(currentRawHtml, options());
    currentRedactedHtml = result.output;

    redactedIframe.srcdoc = currentRedactedHtml;
    redactedCode.value = currentRedactedHtml;
    renderEntities($('html-entities'), result.entities);
    stats($('html-stats'), result, performance.now() - t0);
    btnDownloadHtml.style.display = 'inline-block';
  }

  $('html-upload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    uploadedFileName = file.name ? file.name.replace(/\.html?$/i, '') + '-redacted.html' : 'redacted.html';
    const reader = new FileReader();
    reader.onload = (event) => {
      currentRawHtml = event.target.result;
      processHtmlFile();
    };
    reader.readAsText(file);
  });

  btnDownloadHtml.addEventListener('click', () => {
    if (!currentRedactedHtml) return;
    const blob = new Blob([currentRedactedHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = uploadedFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  function toggleCode(button, code, iframe) {
    button.addEventListener('click', () => {
      const showingCode = code.style.display !== 'none';
      code.style.display = showingCode ? 'none' : 'block';
      iframe.style.display = showingCode ? 'block' : 'none';
      button.textContent = showingCode ? 'View Code' : 'View Preview';
    });
  }
  toggleCode($('toggle-orig-code'), origCode, origIframe);
  toggleCode($('toggle-redacted-code'), redactedCode, redactedIframe);

  // ============================================================
  // SETTINGS: re-run both sections when anything changes
  // ============================================================
  const rerun = () => { runTextRedaction(); processHtmlFile(); };
  styleSel.addEventListener('change', rerun);
  sensitivitySel.addEventListener('change', rerun);
  for (const [el, key] of [[allowInput, 'pii.allow'], [denyInput, 'pii.deny']]) {
    el.addEventListener('change', () => { store.set(key, el.value); rerun(); });
  }
  useNer.addEventListener('change', () => {
    if (useNer.checked) ner.load().catch(() => {});
    updateBadge(ner.state);
    rerun();
  });
});
