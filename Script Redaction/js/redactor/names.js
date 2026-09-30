/**
 * Rule-based person-name detection: gazetteer + contextual cues.
 * Works without the ML model and also acts as a second opinion for NER output.
 */
import { FIRST_NAMES, SURNAMES, AMBIGUOUS, NON_NAME, COMMON_WORDS } from './data/names.js';

const HONORIFIC = /\b(?:Mr|Mrs|Ms|Miss|Dr|Shri|Sri|Smt|Kumari|Kum|Prof|Mx)\.?\s*$/;
const RELATION = /\b(?:[SDWC]\s?\/\s?[Oo]|son of|daughter of|wife of|husband of|father of|mother of)\s*[:\-]?\s*$/i;
const ROLE = /\b(?:husband|wife|spouse|son|daughter|father|mother|brother|sister|guardian|nominee|patient|customer|employee|applicant|beneficiary|cardholder|holder|signed by|co-signed by|witnessed by|referred (?:the case )?to|attended by|assigned to|approved by|contact person|colleague|manager|friend|dear|hi|hello)\s*[,:\-]?\s*$/i;

const TOKEN = /[A-Za-z][A-Za-z'’\-]*/g;
const CUE_REASONS = {
  relation: 'follows a relation cue (S/o, D/o, son of…)',
  honorific: 'follows an honorific (Mr/Mrs/Dr/Smt…)',
  role: 'follows a role word (husband, patient, signed by…)',
};

function tokenize(text) {
  const tokens = [];
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    const word = m[0];
    const lower = word.toLowerCase().replace(/’/g, "'");
    tokens.push({
      word, lower, start: m.index, end: m.index + word.length,
      cap: /^[A-Z][a-z'’\-]+$/.test(word) || (/^[A-Z]{2,}$/.test(word) && (FIRST_NAMES.has(lower) || SURNAMES.has(lower))),
      initial: /^[A-Z]$/.test(word) && text[m.index + 1] === '.',
      first: FIRST_NAMES.has(lower) && !AMBIGUOUS.has(lower),
      sur: SURNAMES.has(lower),
      amb: AMBIGUOUS.has(lower),
      non: NON_NAME.has(lower),
      common: COMMON_WORDS.has(lower),
    });
  }
  return tokens;
}

/** Group capitalized tokens separated by a single space (or ". " after an initial) into runs. */
function capitalizedRuns(text, tokens) {
  const runs = [];
  let cur = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!(t.cap || t.initial)) { if (cur.length) runs.push(cur); cur = []; continue; }
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const gap = text.slice(prev.end, t.start);
      const ok = gap === ' ' || (prev.initial && /^\.\s?$/.test(gap));
      if (!ok) { runs.push(cur); cur = []; }
    }
    cur.push(t);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function cueBefore(text, start) {
  const before = text.slice(Math.max(0, start - 30), start);
  if (RELATION.test(before)) return 'relation';
  if (HONORIFIC.test(before)) return 'honorific';
  if (ROLE.test(before)) return 'role';
  return null;
}

function scoreRun(run, cue) {
  const n = run.filter(t => !t.initial).length;
  const hasFirst = run.some(t => t.first);
  const hasSur = run.some(t => t.sur);
  const hasAmb = run.some(t => t.amb);
  const known = hasFirst || hasSur;
  if (cue === 'relation') return 0.85;
  if (cue === 'honorific') return n >= 2 || known ? 0.85 : 0;
  if (cue === 'role') {
    if (n >= 2) return 0.8;
    return hasFirst ? 0.75 : 0;
  }
  if (n >= 2) {
    if (hasFirst) return hasSur ? 0.85 : 0.8;
    if (hasAmb && hasSur) return 0.75;
    return 0;
  }
  return hasFirst ? 0.55 : 0;
}

export function detectNames(text) {
  const tokens = tokenize(text);
  const spans = [];

  for (const run of capitalizedRuns(text, tokens)) {
    // Split at organization/place words; the part right before one is an org name ("Sharma Traders")
    const parts = [];
    let cur = [];
    for (const t of run) {
      if (t.non) { cur = []; continue; }
      cur.push(t);
      if (cur.length === 1) parts.push(cur);
    }
    for (const part of parts) {
      const lastTok = part[part.length - 1];
      const nextTok = run[run.indexOf(lastTok) + 1];
      if (nextTok && nextTok.non) continue;

      const cue = cueBefore(text, part[0].start);
      let startIdx = 0;
      if (!cue) {
        // Name starts at the first gazetteer token; leading unknown words ("Customer", "Reach") are dropped
        startIdx = part.findIndex(t => (t.first || t.sur || t.amb) && !t.common);
        if (startIdx < 0) continue;
      }
      let name = part.slice(startIdx);
      while (name.length && name[name.length - 1].common) name = name.slice(0, -1);
      if (name.length > 4) name = name.slice(0, 4);
      if (!name.length) continue;
      const usedCue = startIdx === 0 ? cue : null;
      const score = scoreRun(name, usedCue);
      if (!score) continue;
      const known = name.filter(t => t.first || t.sur).map(t => t.word);
      const reasons = [];
      if (usedCue) reasons.push(CUE_REASONS[usedCue]);
      if (known.length) reasons.push(`in name list: ${known.join(', ')}`);
      spans.push({ start: name[0].start, end: name[name.length - 1].end, type: 'NAME', score,
        source: usedCue ? 'cue' : 'gazetteer', reasons });
    }
  }

  // Lowercase full names ("rohit gupta"): both parts must be in the gazetteer
  for (let i = 0; i + 1 < tokens.length; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (a.cap || b.cap || a.word !== a.lower || b.word !== b.lower) continue;
    if (!a.first || a.common || !b.sur) continue;
    if (text.slice(a.end, b.start) !== ' ') continue;
    spans.push({ start: a.start, end: b.end, type: 'NAME', score: 0.6, source: 'gazetteer',
      reasons: [`lowercase first name + surname in name list: ${a.word} ${b.word}`] });
  }
  return spans;
}

/**
 * Given confirmed names, find their other occurrences in text (word-bounded).
 * Multi-word names also propagate their distinctive single tokens ("Priya Nair" -> "Priya").
 */
export function propagateNames(text, names) {
  const spans = [];
  const seen = new Set();
  const addAll = (needle, score, from) => {
    if (seen.has(needle)) return;
    seen.add(needle);
    const re = new RegExp(`(?<![A-Za-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'g');
    let m;
    while ((m = re.exec(text))) {
      spans.push({ start: m.index, end: m.index + needle.length, type: 'NAME', score, source: 'propagated',
        reasons: [`mention of confirmed name '${from}'`] });
    }
  };
  for (const name of names) {
    if (name.length < 3) continue;
    addAll(name, 0.8, name);
    const parts = name.split(/\s+/);
    if (parts.length > 1) {
      for (const p of parts) {
        const lower = p.toLowerCase();
        if (p.length >= 4 && /^[A-Z]/.test(p) && !AMBIGUOUS.has(lower) && !COMMON_WORDS.has(lower) && !NON_NAME.has(lower)) {
          addAll(p, 0.7, name);
        }
      }
    }
  }
  return spans;
}
