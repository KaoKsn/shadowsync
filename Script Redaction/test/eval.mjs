/**
 * Redaction quality harness.
 *
 *   node test/eval.mjs                  # new engine, full hybrid (NER if model present)
 *   node test/eval.mjs --no-ner         # new engine, regex + checksum + gazetteer only
 *   node test/eval.mjs --engine=legacy  # original pii-redactor.js (baseline)
 *   node test/eval.mjs --verbose        # print every leak / over-redaction
 *   node test/eval.mjs --corpus=holdout # held-out samples (never tune detectors against these)
 *
 * Scoring is engine-agnostic and value-based:
 *   - recall: a labeled entity is "leaked" if its value still appears in the output
 *     (normalized text content, or anywhere in the raw HTML incl. attributes).
 *   - keep rate: every `keep` string (hard negatives / boilerplate) must survive.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const engineName = args.engine || 'new';
const useNer = !args['no-ner'];

// Browser globals the engines expect
const { window } = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = window.DOMParser;
globalThis.Node = window.Node;
globalThis.NodeFilter = window.NodeFilter;

const norm = (s) => String(s || '').normalize('NFKC').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();

function textOf(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  return norm(dom.window.document.body.textContent);
}

function decodeEntities(html) {
  return html.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function loadEngine(name) {
  if (name === 'legacy') {
    const src = readFileSync(join(here, 'legacy', 'pii-redactor.legacy.cjs'), 'utf8');
    const mod = { exports: {} };
    new Function('module', 'exports', src)(mod, mod.exports);
    const nlp = (await import('compromise')).default;
    globalThis.nlp = nlp;
    const PIIRedactor = mod.exports;
    const r = new PIIRedactor({ style: 'token' });
    return {
      label: 'legacy (regex + Compromise.js)',
      text: async (t) => ({ output: r.redactText(t) }),
      html: async (h) => ({ output: r.redactHTML(h) }),
    };
  }
  const { PIIRedactor } = await import('../js/redactor/index.js');
  const r = new PIIRedactor({ style: 'token', ner: { enabled: useNer } });
  let nerUsed = false;
  if (useNer) {
    const ner = await import('./node-ner.mjs')
      .then(m => m.createNodeNer())
      .catch((e) => { console.warn(`NER unavailable: ${e.message}`); return null; });
    if (ner) { r.setNerBackend(ner); nerUsed = true; }
  }
  return {
    label: `new (regex + checksum + gazetteer${nerUsed ? ' + NER' : ''})`,
    text: (t) => r.redactTextAsync(t),
    html: (h) => r.redactHTMLAsync(h),
  };
}

function loadCorpus() {
  const dir = join(here, args.corpus === 'holdout' ? 'holdout' : 'corpus');
  const samples = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const kind = f.startsWith('html') ? 'html' : 'text';
    for (const s of JSON.parse(readFileSync(join(dir, f), 'utf8'))) samples.push({ kind, ...s });
  }
  return samples;
}

const engine = await loadEngine(engineName);
const samples = loadCorpus();
const perType = {};
const leaks = [];
const overRedactions = [];
let keepTotal = 0;
let keepOk = 0;
const t0 = performance.now();

for (const s of samples) {
  const res = await engine[s.kind](s.content);
  const out = res.output;
  const visible = s.kind === 'html' ? textOf(out) : norm(out);
  const raw = s.kind === 'html' ? norm(decodeEntities(out)) : visible;

  for (const e of s.entities) {
    const v = norm(e.value);
    const leaked = visible.includes(v) || raw.includes(v);
    const bucket = (perType[e.type] ||= { total: 0, caught: 0 });
    bucket.total++;
    if (!leaked) bucket.caught++;
    else leaks.push({ id: s.id, type: e.type, value: e.value });
  }
  for (const k of s.keep || []) {
    keepTotal++;
    if (visible.includes(norm(k)) || raw.includes(norm(k))) keepOk++;
    else overRedactions.push({ id: s.id, keep: k, output: visible });
  }
}

const ms = performance.now() - t0;
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '-').padStart(6);
const allTotal = Object.values(perType).reduce((a, b) => a + b.total, 0);
const allCaught = Object.values(perType).reduce((a, b) => a + b.caught, 0);

console.log(`\nEngine: ${engine.label}`);
console.log(`Samples: ${samples.length}   time: ${ms.toFixed(0)} ms\n`);
console.log('TYPE                 caught/total  recall%');
for (const [type, b] of Object.entries(perType).sort()) {
  console.log(`${type.padEnd(20)} ${`${b.caught}/${b.total}`.padStart(12)}  ${pct(b.caught, b.total)}`);
}
console.log('-'.repeat(42));
console.log(`${'OVERALL RECALL'.padEnd(20)} ${`${allCaught}/${allTotal}`.padStart(12)}  ${pct(allCaught, allTotal)}`);
console.log(`${'KEEP RATE (precision)'.padEnd(20)} ${`${keepOk}/${keepTotal}`.padStart(11)}  ${pct(keepOk, keepTotal)}`);

if (leaks.length) {
  console.log(`\nLeaks (${leaks.length}):`);
  for (const l of leaks) console.log(`  [${l.id}] ${l.type}: ${l.value}`);
}
if (overRedactions.length) {
  console.log(`\nOver-redactions (${overRedactions.length}):`);
  for (const o of overRedactions) {
    console.log(`  [${o.id}] lost "${o.keep}"${args.verbose ? `\n      -> ${o.output}` : ''}`);
  }
}
