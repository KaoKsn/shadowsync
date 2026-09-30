/**
 * DOM support: turns a document/element into text "segments" for detection and
 * writes the redactions back into the original text nodes and attributes.
 *
 * - Segments are block-level: all text nodes under the same block element are joined,
 *   so "<b>7890</b> <b>1234</b> <b>5674</b>" is seen as one Aadhaar number.
 * - Structured pairing (label -> value) produces forced spans and context hints.
 */
import { resolveLabel, isFieldKeyword, isPlaceholder } from './fields.js';
import { formatTag } from './render.js';
import { inferColumnType } from './columns.js';

// HTML autocomplete tokens (https://html.spec.whatwg.org/#autofill) -> PII type
const AUTOCOMPLETE_TYPES = {
  name: 'NAME', 'given-name': 'NAME', 'family-name': 'NAME', 'additional-name': 'NAME', nickname: 'NAME',
  'honorific-prefix': 'NAME', 'cc-name': 'NAME', 'cc-given-name': 'NAME', 'cc-family-name': 'NAME',
  email: 'EMAIL', tel: 'PHONE', 'tel-national': 'PHONE', 'tel-local': 'PHONE', 'tel-area-code': 'PHONE',
  'street-address': 'ADDRESS', 'address-line1': 'ADDRESS', 'address-line2': 'ADDRESS', 'address-line3': 'ADDRESS',
  'address-level1': 'LOCATION', 'address-level2': 'LOCATION', 'address-level3': 'LOCATION', 'postal-code': 'PINCODE',
  bday: 'DOB', 'bday-day': 'DOB', 'bday-month': 'DOB', 'bday-year': 'DOB', sex: 'SENSITIVE_ATTRIBUTE',
  'cc-number': 'CREDIT_CARD', 'cc-csc': 'CVV', 'cc-exp': 'EXPIRY', 'cc-exp-month': 'EXPIRY', 'cc-exp-year': 'EXPIRY',
  username: 'USERNAME', 'current-password': 'PASSWORD', 'new-password': 'PASSWORD', 'one-time-code': 'PIN',
};
const INPUT_TYPES = { email: 'EMAIL', tel: 'PHONE', password: 'PASSWORD' };

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'OBJECT', 'CANVAS']);
const BLOCK = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'DD', 'DETAILS', 'DIALOG', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN',
  'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TD', 'TH', 'TR', 'UL', 'CAPTION', 'SUMMARY',
  'LABEL', 'LEGEND', 'OPTION', 'BUTTON', 'SELECT', 'TEXTAREA', 'HTML']);
const HEADER_SELECTOR = 'thead, caption, h1, h2, h3, h4, h5, h6, [role="heading"], [role="columnheader"]';
const TEXT_ATTRS = ['value', 'placeholder', 'title', 'alt', 'aria-label', 'href'];
const NON_VALUE_INPUTS = new Set(['submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'color', 'range', 'file']);

const SHOW_ELEMENT = 1;
const SHOW_TEXT = 4;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

function blockOf(node) {
  let el = node.parentElement;
  while (el && !BLOCK.has(el.tagName.toUpperCase())) el = el.parentElement;
  return el;
}

function isSkipped(node) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP.has(el.tagName.toUpperCase())) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Structured label -> value pairing
// ---------------------------------------------------------------------------
function findStructuredValues(queryRoot) {
  const found = new Map(); // element -> { type, mode, label }
  const all = (sel) => {
    const out = [];
    if (queryRoot.matches && queryRoot.matches(sel)) out.push(queryRoot);
    out.push(...queryRoot.querySelectorAll(sel));
    return out;
  };
  // mark(el, labelText, how): map a label to a type; setType(el, type, label, how): type known directly
  const mark = (el, labelText, how) => {
    if (!el || found.has(el)) return;
    const res = resolveLabel(labelText);
    if (res) found.set(el, { ...res, label: labelText.trim(), how: `${how} '${labelText.trim()}'` });
  };
  const setType = (el, type, label, how) => {
    if (!el || found.has(el)) return;
    found.set(el, { type, mode: 'value', label, how });
  };

  // 0. Browser form hints: the page itself declares what a field holds (most specific signal)
  for (const input of all('input, textarea, select, [autocomplete]')) {
    const tokens = (input.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/);
    const token = tokens.find(t => AUTOCOMPLETE_TYPES[t]);
    if (token) { setType(input, AUTOCOMPLETE_TYPES[token], token, `autocomplete="${token}"`); continue; }
    const inputType = (input.getAttribute('type') || '').toLowerCase();
    if (input.tagName === 'INPUT' && INPUT_TYPES[inputType]) {
      setType(input, INPUT_TYPES[inputType], inputType, `input type="${inputType}"`);
    }
  }

  // 1. Class-marked pairs: <span class="label">SSN</span> ... <span class="value">...</span>
  let pending = null;
  for (const el of all('.label, .value')) {
    if (el.classList.contains('label')) { pending = el; continue; }
    if (pending) {
      const boundary = 'tr, .data-row, .field, .form-group, li, p, div';
      const a = pending.closest(boundary);
      if (!a || a === el.closest(boundary) || a.contains(el)) mark(el, textOf(pending), '.label/.value pair');
    }
    pending = null;
  }

  // 2. Tables: column headers, row label/value pairs, then column inference from cell values
  for (const table of all('table')) {
    const rows = Array.from(table.rows || []);
    if (!rows.length) continue;
    const headRow = rows.find(r => r.parentElement && r.parentElement.tagName === 'THEAD') ||
      (Array.from(rows[0].cells).every(c => c.tagName === 'TH') ? rows[0] : null);
    const columns = headRow ? Array.from(headRow.cells).map(c => textOf(c)) : [];
    const bodyRows = rows.filter(r => r !== headRow);
    for (const row of bodyRows) {
      const cells = Array.from(row.cells);
      cells.forEach((cell, i) => {
        if (cell.tagName === 'TD' && columns[i]) mark(cell, columns[i], 'table column');
      });
      for (let i = 0; i < cells.length - 1; i++) {
        const next = cells[i + 1];
        if (next.tagName !== 'TD' || resolveLabel(textOf(next))) continue;
        if (resolveLabel(textOf(cells[i]))) { found.delete(next); mark(next, textOf(cells[i]), 'table row label'); }
      }
    }
    const width = Math.max(0, ...bodyRows.map(r => r.cells.length));
    for (let col = 0; col < width; col++) {
      const cells = bodyRows.map(r => r.cells[col]).filter(c => c && c.tagName === 'TD');
      if (cells.some(c => found.has(c))) continue; // already typed by a header or row label
      const inferred = inferColumnType(cells.map(textOf));
      if (!inferred) continue;
      const how = `column inference: ${inferred.count}/${inferred.total} cells are ${inferred.type}`;
      for (const c of cells) {
        setType(c, inferred.type, columns[col] || '', how);
        found.get(c).score = 0.9; // inferred, so a little below explicit labels
      }
    }
  }

  // 3. Definition lists and form labels
  for (const dt of all('dt')) {
    for (let dd = dt.nextElementSibling; dd && dd.tagName === 'DD'; dd = dd.nextElementSibling) mark(dd, textOf(dt), 'definition list');
  }
  for (const label of all('label')) {
    const text = textOf(label);
    const forId = label.getAttribute('for');
    // Attribute selector instead of getElementById: works on detached clones too
    const target = (forId && queryRoot.querySelector(`[id="${forId.replace(/["\\]/g, '\\$&')}"]`)) ||
      label.querySelector('input, select, textarea') ||
      (label.nextElementSibling && !['LABEL', 'DT'].includes(label.nextElementSibling.tagName) ? label.nextElementSibling : null);
    mark(target, text, 'form label');
  }

  // 4. Inputs described by their own name / id / placeholder / aria-label
  for (const input of all('input, textarea')) {
    if (found.has(input)) continue;
    for (const attr of ['aria-label', 'name', 'id', 'placeholder']) {
      const v = input.getAttribute(attr);
      if (v && resolveLabel(v.replace(/[_\-]+/g, ' '))) { mark(input, v.replace(/[_\-]+/g, ' '), `input ${attr}`); break; }
    }
  }

  // Values never come from headers
  for (const el of Array.from(found.keys())) {
    if (el.closest && (el.closest(HEADER_SELECTOR) || el.closest('th'))) found.delete(el);
  }
  return found;
}

function structuredFor(node, structured) {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (structured.has(el)) return { el, info: structured.get(el) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------
/**
 * Collect text segments and attribute jobs from a DOM root.
 * Segment: { text, parts: [{ node, start, end }], hint, forced: [...] }
 * Attribute job: { el, attr, text, hint, forced }
 */
export function collectSegments(root) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument;
  const queryRoot = root.nodeType === 9 ? root.documentElement : root;
  const structured = findStructuredValues(queryRoot);

  const segments = [];
  let seg = null;
  let pendingBreak = false;
  const walker = doc.createTreeWalker(root, SHOW_ELEMENT | SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === ELEMENT_NODE) {
      if (node.tagName.toUpperCase() === 'BR') pendingBreak = true;
      continue;
    }
    if (node.nodeType !== TEXT_NODE || !node.nodeValue || isSkipped(node)) continue;
    const block = blockOf(node);
    const owner = structuredFor(node, structured);
    const ownerEl = owner ? owner.el : null;
    if (!seg || seg.block !== block || seg.ownerEl !== ownerEl) {
      seg = { block, ownerEl, owner, text: '', parts: [], hint: owner ? owner.info.label : '', forced: [] };
      segments.push(seg);
      pendingBreak = false;
    } else {
      const prev = seg.parts[seg.parts.length - 1];
      let sep = '';
      if (pendingBreak) sep = '\n';
      else if (prev && prev.node.parentElement !== node.parentElement && !/\s$/.test(seg.text) && !/^\s/.test(node.nodeValue)) sep = ' ';
      seg.text += sep;
      pendingBreak = false;
    }
    const start = seg.text.length;
    seg.text += node.nodeValue;
    seg.parts.push({ node, start, end: seg.text.length });
  }

  // Forced span over the whole (trimmed) structured value
  for (const s of segments) {
    if (!s.owner || s.owner.info.mode !== 'value') continue;
    const value = s.text.trim();
    if (!value || isPlaceholder(value) || isFieldKeyword(value) || /\[REDACTED_|█{3}/.test(value)) continue;
    if (s.owner.info.type === 'ADDRESS' && /same as/i.test(value)) continue;
    const start = s.text.indexOf(value);
    const info = s.owner.info;
    s.forced.push({ start, end: start + value.length, type: info.type, score: info.score || 0.97,
      source: 'structured', reasons: [info.how] });
  }

  // Attributes (input values, placeholders, alt/title text, mailto:/tel: links)
  const attrs = [];
  const elements = [queryRoot, ...queryRoot.querySelectorAll('*')];
  for (const el of elements) {
    if (SKIP.has(el.tagName.toUpperCase())) continue;
    const info = structured.get(el);
    for (const attr of TEXT_ATTRS) {
      const text = el.getAttribute(attr);
      if (!text || !text.trim()) continue;
      if (attr === 'value' && el.tagName === 'INPUT' && NON_VALUE_INPUTS.has((el.getAttribute('type') || '').toLowerCase())) continue;
      if (attr === 'href' && !/^(?:mailto|tel|sms):/i.test(text) && !/[?&][^=]*=/.test(text)) continue;
      const job = { el, attr, text, hint: info && attr === 'value' ? info.label : '', forced: [] };
      if (info && info.mode === 'value' && attr === 'value' && !isPlaceholder(text) && !isFieldKeyword(text)) {
        job.forced.push({ start: 0, end: text.length, type: info.type, score: info.score || 0.97,
          source: 'structured', reasons: [info.how] });
      }
      attrs.push(job);
    }
  }
  return { segments, attrs };
}

/** Write spans (offsets into seg.text) back into the segment's text nodes. */
export function applyToSegment(seg, spans, style) {
  const edits = new Map(); // node -> [{ s, e, rep }]
  for (const span of spans) {
    let first = true;
    for (const p of seg.parts) {
      if (p.end <= span.start || p.start >= span.end) continue;
      const s = Math.max(span.start, p.start) - p.start;
      const e = Math.min(span.end, p.end) - p.start;
      const rep = first ? formatTag(span.type, style, seg.text.slice(span.start, span.end)) : '';
      first = false;
      if (!edits.has(p.node)) edits.set(p.node, []);
      edits.get(p.node).push({ s, e, rep });
    }
  }
  for (const [node, list] of edits) {
    let v = node.nodeValue;
    for (const { s, e, rep } of list.sort((a, b) => b.s - a.s)) v = v.slice(0, s) + rep + v.slice(e);
    node.nodeValue = v;
  }
}

export function applyToAttribute(job, redactedText) {
  job.el.setAttribute(job.attr, redactedText);
  if (job.attr === 'value' && 'value' in job.el) {
    try { job.el.value = redactedText; } catch (e) { /* read-only in some environments */ }
  }
}
