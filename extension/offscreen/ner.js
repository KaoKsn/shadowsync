/**
 * PrivSight — Offscreen PII Engine
 *
 * Runs the Script Redaction engine (regex + checksums + fields + gazetteer) plus the
 * DistilBERT-NER model once per browser session, shared by every tab. Everything is
 * loaded from the extension bundle (lib/pii/, built by `npm run build:extension`).
 *
 *   in : { target: 'offscreen', type: 'PII_WARMUP' }                -> { ok, status }
 *   in : { target: 'offscreen', type: 'PII_ANALYZE', texts: [...] } -> { ok, entities: [[{ text, type, score, words }]], nerUsed }
 */
import { PIIRedactor, NerClient } from '../lib/pii/js/pii-redactor.js';
import { isFieldKeyword } from '../lib/pii/js/redactor/fields.js';
import { AMBIGUOUS, COMMON_WORDS, NON_NAME } from '../lib/pii/js/redactor/data/names.js';

/**
 * Individual words of a NAME entity, for pages that split a name across elements
 * ("<b>Priya</b> Sharma") or mention it again later ("Priya"). Label and common words
 * the span may have absorbed ("Bill To …", "… Aadhaar") are dropped.
 */
function nameWords(text) {
  return text.split(/\s+/).filter((w) => {
    const key = w.toLowerCase().replace(/[^\p{L}]/gu, '');
    return w.length >= 3 && /^\p{Lu}/u.test(w) && !isFieldKeyword(w)
      && !COMMON_WORDS.has(key) && !NON_NAME.has(key) && !AMBIGUOUS.has(key);
  });
}

const ner = new NerClient();
const redactor = new PIIRedactor({ sensitivity: 'balanced' }).setNerBackend(ner);

ner.onStatus((s) => {
  if (s.status === 'ready') console.log(`[PrivSight PII] NER ready (backend: ${s.backend})`);
  if (s.status === 'error') console.warn('[PrivSight PII] NER failed to load, rules-only:', s.error);
});

// Load the model right away so the first capture doesn't pay the cold start.
ner.load().catch(() => {});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;

  if (message.type === 'PII_WARMUP') {
    ner.load()
      .then(() => sendResponse({ ok: true, status: ner.state.status }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message.type === 'PII_ANALYZE') {
    const started = performance.now();
    redactor.analyzeTextsAsync(message.texts || [])
      .then(({ entities, nerUsed }) => {
        sendResponse({
          ok: true,
          nerUsed,
          ms: Math.round(performance.now() - started),
          entities: entities.map(list => list.map(e => ({
            text: e.text,
            type: e.type,
            score: e.score,
            words: e.type === 'NAME' ? nameWords(e.text) : [],
          }))),
        });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  return false;
});
