/**
 * PIIRedactor – hybrid, span-based PII redaction that runs entirely in the browser.
 *
 *   detectors (regex + checksum validators, "Label: value" fields, DOM structure,
 *              name gazetteer/cues, optional NER model)
 *     -> candidate spans {start, end, type, score, source}
 *     -> resolve overlaps + sensitivity threshold
 *     -> propagate confirmed names to their other mentions
 *     -> render once (token | blackout | mask)
 *
 * Sync methods (redactText / redactHTML / analyze*) never use the ML model.
 * Async methods (*Async) add NER when a backend is attached via setNerBackend().
 */
import { normalizeWithMap, mapRange } from './normalize.js';
import { runPatterns } from './patterns.js';
import { detectLabeledValues, isFieldKeyword } from './fields.js';
import { detectNames, propagateNames } from './names.js';
import { resolveSpans, SENSITIVITY_THRESHOLDS } from './resolve.js';
import { applySpans, formatTag } from './render.js';
import { collectSegments, applyToSegment, applyToAttribute } from './dom.js';
import { detectDelimitedTable } from './columns.js';
import { AMBIGUOUS, COMMON_WORDS, NON_NAME } from './data/names.js';

const DEFAULTS = {
  style: 'token',          // 'token' | 'blackout' | 'mask'
  sensitivity: 'balanced', // 'low' | 'balanced' | 'high' (high redacts more)
  types: null,             // only redact these types (null = all)
  exclude: [],             // never redact these types
  names: true,             // gazetteer + cue based name detection
  propagate: true,         // redact every mention of a confirmed name
  allow: [],               // never redact: strings (case-insensitive, whole words) or RegExps
  deny: [],                // always redact: strings, RegExps, or { value, type }
  ner: { enabled: true, labels: ['PER'], minScore: 0.8 },
};

const NER_TYPES = { PER: 'NAME', ORG: 'ORGANIZATION', LOC: 'LOCATION' };
const NER_STOPWORDS = new Set([...COMMON_WORDS, ...NON_NAME, 'regards', 'cheers', 'warmly', 'team', 'all', 'everyone',
  'admin', 'support', 'sir', 'madam', 'maam', 'guys', 'folks', 'bro', 'boss', 'yours', 'truly', 'faithfully']);
const HTML_LIKE = /<\/?[a-z][\w:-]*(?:\s[^<>]*)?>/i;

function mergeOptions(base, custom = {}) {
  return { ...base, ...custom, ner: { ...base.ner, ...(custom.ner || {}) } };
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compile allow/deny list entries into global regexes. */
function compileTerms(list) {
  return (list || []).map((entry) => {
    const t = entry && typeof entry === 'object' && !(entry instanceof RegExp) ? entry : { value: entry };
    let re;
    if (t.value instanceof RegExp) {
      re = new RegExp(t.value.source, t.value.flags.includes('g') ? t.value.flags : `${t.value.flags}g`);
    } else {
      const s = String(t.value ?? '').trim();
      if (!s) return null;
      re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(s)}(?![A-Za-z0-9])`, 'gi');
    }
    return { re, type: t.type || 'CUSTOM', label: t.value instanceof RegExp ? String(t.value) : `'${String(t.value).trim()}'` };
  }).filter(Boolean);
}

function findTerms(text, terms) {
  const out = [];
  for (const term of terms) {
    term.re.lastIndex = 0;
    let m;
    while ((m = term.re.exec(text))) {
      if (!m[0]) { term.re.lastIndex++; continue; }
      out.push({ start: m.index, end: m.index + m[0].length, term });
    }
  }
  return out;
}

/**
 * Clean a raw NER entity: names never cross line breaks / cell separators, and
 * leading/trailing stopwords the model sometimes absorbs ("To" in "Bill To\nVivek Anand",
 * "Regards") are trimmed. Returns zero or more sub-entities.
 */
function splitNerEntity(text, e) {
  const out = [];
  const isStop = (w) => NER_STOPWORDS.has(w.toLowerCase().replace(/[^a-z]/g, ''));
  const piece = /[^\n\r\t|;]+/g;
  let m;
  while ((m = piece.exec(text.slice(e.start, e.end)))) {
    const base = e.start + m.index;
    const words = [...m[0].matchAll(/[\p{L}\p{M}'’.\-]+/gu)];
    let first = 0;
    let last = words.length - 1;
    while (first <= last && isStop(words[first][0])) first++;
    while (last >= first && isStop(words[last][0])) last--;
    if (first > last) continue;
    out.push({ ...e, start: base + words[first].index, end: base + words[last].index + words[last][0].length });
  }
  return out;
}

export class PIIRedactor {
  constructor(options = {}) {
    this.options = mergeOptions(DEFAULTS, options);
    this._ner = null;
  }

  /** Attach an NER backend: { analyze(texts: string[]) -> Promise<Array<Array<{start,end,label,score}>>> } */
  setNerBackend(backend) {
    this._ner = backend;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Core pipeline
  // ---------------------------------------------------------------------------
  _detect(text, hint, opts) {
    const norm = normalizeWithMap(text);
    const raw = [...runPatterns(norm.text, { hint }), ...detectLabeledValues(norm.text), ...detectDelimitedTable(norm.text)];
    if (opts.names) raw.push(...detectNames(norm.text));
    return raw.map((s) => {
      const [start, end] = mapRange(norm.map, s.start, s.end, text);
      return { ...s, start, end };
    });
  }

  _fuseNer(text, cands, entities, opts) {
    // Local parts of detected emails / UPI IDs: "tenzin.dolma@..." corroborates "Tenzin Dolma"
    const handles = cands.filter(c => c.type === 'EMAIL' || c.type === 'UPI')
      .map(c => text.slice(c.start, c.end).split('@')[0].toLowerCase());
    const inHandle = (name) => {
      const toks = name.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
      return toks.length > 0 && handles.some(h => toks.every(t => h.includes(t)));
    };

    const out = [];
    for (const raw of entities || []) {
      const type = NER_TYPES[raw.label];
      if (!type || !opts.ner.labels.includes(raw.label)) continue;
      for (const e of splitNerEntity(text, raw)) {
        const value = text.slice(e.start, e.end);
        if (isFieldKeyword(value)) continue; // "Aadhaar", "Passport" are labels, not entities
        const byRules = cands.some(c => c.type === type && overlaps(c, e));
        const byHandle = type === 'NAME' && inHandle(value);
        const agrees = byRules || byHandle;
        // Single words that are also common English words ("Will", "Grace") need a second opinion
        if (type === 'NAME' && !agrees && !/\s/.test(value) && AMBIGUOUS.has(value.toLowerCase())) continue;
        let score = e.score >= opts.ner.minScore ? e.score : (agrees && e.score >= 0.6 ? 0.85 : 0);
        if (!score) continue;
        if (agrees) score = Math.max(score, 0.9);
        const reasons = [`NER ${raw.label} ${e.score.toFixed(2)}`];
        if (byRules) reasons.push('agrees with rule-based detection');
        if (byHandle) reasons.push('name matches an email/UPI handle in the text');
        out.push({ start: e.start, end: e.end, type, score, source: 'ner', reasons });
      }
    }
    // Rule-based names confirmed by the model become high confidence
    for (const c of cands) {
      if (c.type === 'NAME' && out.some(n => n.type === 'NAME' && overlaps(n, c))) {
        c.score = Math.max(c.score, 0.9);
        c.reasons = [...(c.reasons || []), 'confirmed by NER model'];
      }
    }
    return out;
  }

  /**
   * items: [{ text, hint, forced }] -> per-item resolved entities (offsets into item.text)
   * nerResults: optional per-item NER entities
   */
  _resolveItems(items, opts, nerResults = null) {
    const threshold = SENSITIVITY_THRESHOLDS[opts.sensitivity] ?? 0.5;
    const allowed = (t) => (!opts.types || opts.types.includes(t)) && !opts.exclude.includes(t);

    const allowTerms = compileTerms(opts.allow);
    const denyTerms = compileTerms(opts.deny);
    // Allow list: drop any detection that lies entirely inside an allowed phrase
    const applyAllow = (text, spans) => {
      if (!allowTerms.length) return spans;
      const ranges = findTerms(text, allowTerms);
      return spans.filter(s => !ranges.some(r => r.start <= s.start && s.end <= r.end));
    };

    const cands = items.map((it, i) => {
      const c = /[A-Za-z0-9]/.test(it.text || '') ? this._detect(it.text, it.hint || '', opts) : [];
      if (nerResults && nerResults[i]) c.push(...this._fuseNer(it.text, c, nerResults[i], opts));
      c.push(...(it.forced || []));
      const kept = applyAllow(it.text || '', c.filter(s => allowed(s.type)));
      // Deny list: always redacted, and it wins over the allow list
      for (const d of findTerms(it.text || '', denyTerms)) {
        kept.push({ start: d.start, end: d.end, type: d.term.type, score: 0.99, source: 'deny', reasons: [`deny list ${d.term.label}`] });
      }
      return kept;
    });
    let resolved = cands.map(c => resolveSpans(c, { threshold }));

    if (opts.propagate && allowed('NAME')) {
      const names = new Set();
      resolved.forEach((spans, i) => spans.forEach((s) => {
        const text = items[i].text.slice(s.start, s.end).trim();
        if (s.type === 'NAME' && (s.score >= 0.7 || /\s/.test(text))) names.add(text);
      }));
      if (names.size) {
        resolved = resolved.map((spans, i) => {
          const extra = applyAllow(items[i].text, propagateNames(items[i].text, [...names]));
          return extra.length ? resolveSpans([...cands[i], ...extra], { threshold }) : spans;
        });
      }
    }

    return resolved.map((spans, i) => spans.map(s => ({
      type: s.type,
      start: s.start,
      end: s.end,
      text: items[i].text.slice(s.start, s.end),
      score: Math.round(s.score * 100) / 100,
      sources: s.sources,
      reasons: s.reasons,
    })));
  }

  async _runNer(texts, opts) {
    if (!opts.ner.enabled || !this._ner) return { results: null, used: false };
    const idx = [];
    const batch = [];
    texts.forEach((t, i) => { if (t && /[A-Za-z]{2}/.test(t)) { idx.push(i); batch.push(t); } });
    if (!batch.length) return { results: null, used: true };
    try {
      const res = await this._ner.analyze(batch);
      const results = new Array(texts.length).fill(null);
      idx.forEach((orig, k) => { results[orig] = res[k]; });
      return { results, used: true };
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[PIIRedactor] NER failed, continuing without it:', e);
      return { results: null, used: false };
    }
  }

  // ---------------------------------------------------------------------------
  // Plain text
  // ---------------------------------------------------------------------------
  analyzeText(text, customOptions = {}) {
    const opts = mergeOptions(this.options, customOptions);
    const src = String(text ?? '');
    const [entities] = this._resolveItems([{ text: src }], opts);
    return { output: applySpans(src, entities, opts.style), entities, nerUsed: false };
  }

  async redactTextAsync(text, customOptions = {}) {
    const opts = mergeOptions(this.options, customOptions);
    const src = String(text ?? '');
    const ner = await this._runNer([src], opts);
    const [entities] = this._resolveItems([{ text: src }], opts, ner.results);
    return { output: applySpans(src, entities, opts.style), entities, nerUsed: ner.used };
  }

  /** Backwards compatible: returns a string; HTML input is routed to redactHTML. */
  redactText(text, customOptions = {}) {
    if (!text || typeof text !== 'string') return '';
    if (HTML_LIKE.test(text) && typeof DOMParser !== 'undefined') return this.redactHTML(text, customOptions);
    return this.analyzeText(text, customOptions).output;
  }

  // ---------------------------------------------------------------------------
  // HTML / DOM
  // ---------------------------------------------------------------------------
  _prepare(input, opts) {
    if (input && typeof input === 'object' && typeof input.cloneNode === 'function') {
      const root = opts.inPlace ? input : input.cloneNode(true);
      return { root, serialize: () => root };
    }
    if (typeof DOMParser === 'undefined') throw new Error('PIIRedactor: HTML redaction needs DOMParser (browser, offscreen document or jsdom)');
    const source = String(input ?? '');
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const serialize = /<html[\s>]/i.test(source)
      ? () => `${doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : ''}${doc.documentElement.outerHTML}`
      : () => doc.body.innerHTML;
    return { root: doc, serialize };
  }

  _collect(root) {
    const { segments, attrs } = collectSegments(root);
    const items = [...segments, ...attrs].map(x => ({ text: x.text, hint: x.hint, forced: x.forced }));
    return { segments, attrs, items };
  }

  _apply(segments, attrs, perItem, opts) {
    const entities = [];
    segments.forEach((seg, i) => {
      if (perItem[i].length) applyToSegment(seg, perItem[i], opts.style);
      perItem[i].forEach(e => entities.push({ ...e, where: 'text' }));
    });
    attrs.forEach((job, k) => {
      const spans = perItem[segments.length + k];
      if (!spans.length) return;
      applyToAttribute(job, applySpans(job.text, spans, opts.style));
      spans.forEach(e => entities.push({ ...e, where: `@${job.attr}` }));
    });
    return entities;
  }

  analyzeHTML(input, customOptions = {}) {
    const opts = mergeOptions(this.options, customOptions);
    const { root, serialize } = this._prepare(input, opts);
    const { segments, attrs, items } = this._collect(root);
    const entities = this._apply(segments, attrs, this._resolveItems(items, opts), opts);
    return { output: serialize(), entities, nerUsed: false };
  }

  async redactHTMLAsync(input, customOptions = {}) {
    const opts = mergeOptions(this.options, customOptions);
    const { root, serialize } = this._prepare(input, opts);
    const { segments, attrs, items } = this._collect(root);
    const ner = await this._runNer(items.map(it => it.text), opts);
    const entities = this._apply(segments, attrs, this._resolveItems(items, opts, ner.results), opts);
    return { output: serialize(), entities, nerUsed: ner.used };
  }

  /** Backwards compatible: string in -> string out; DOM node in -> redacted clone out. */
  redactHTML(input, customOptions = {}) {
    if (!input) return '';
    return this.analyzeHTML(input, customOptions).output;
  }

  redactDOM(root, customOptions = {}) {
    if (!root || typeof root.cloneNode !== 'function') return null;
    return this.analyzeHTML(root, customOptions).output;
  }

  async redactDOMAsync(root, customOptions = {}) {
    return (await this.redactHTMLAsync(root, customOptions)).output;
  }
}

PIIRedactor.formatTag = formatTag;
PIIRedactor.redactText = (text, opts) => new PIIRedactor(opts).redactText(text);
PIIRedactor.redactHTML = (html, opts) => new PIIRedactor(opts).redactHTML(html);

export default PIIRedactor;
