/**
 * Environment-agnostic NER inference on top of Transformers.js tokenizer + model.
 * Used by the browser Web Worker (ner-worker.js) and by the Node eval harness.
 *
 * Transformers.js' token-classification pipeline returns no character offsets, so
 * this module aligns sub-word tokens back to the source text itself and decodes
 * BIO tags into entity spans: [{ start, end, label: 'PER'|'ORG'|'LOC'|'MISC', score, text }].
 */

const LABEL_ALIASES = { PERSON: 'PER', PER: 'PER', ORG: 'ORG', ORGANIZATION: 'ORG', ORGANISATION: 'ORG',
  LOC: 'LOC', LOCATION: 'LOC', GPE: 'LOC', MISC: 'MISC' };
const SPECIAL = /^(?:\[(?:CLS|SEP|PAD|MASK)\]|<\/?s>|<pad>|<mask>|\[UNK\]|<unk>)$/;
const MAX_CHUNK_CHARS = 1000; // ~250-350 word pieces, well under the 512 token limit

/** Split long text into chunks at sentence / line boundaries, keeping offsets. */
export function chunkText(text, max = MAX_CHUNK_CHARS) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + max);
    if (end < text.length) {
      const window = text.slice(start, end);
      const cut = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
      if (cut > max * 0.5) end = start + cut + 1;
      else {
        const space = window.lastIndexOf(' ');
        if (space > max * 0.5) end = start + space;
      }
    }
    chunks.push({ text: text.slice(start, end), offset: start });
    start = end;
  }
  return chunks;
}

function softmaxArgmax(data, offset, n) {
  let max = -Infinity;
  let arg = 0;
  for (let k = 0; k < n; k++) if (data[offset + k] > max) { max = data[offset + k]; arg = k; }
  let sum = 0;
  for (let k = 0; k < n; k++) sum += Math.exp(data[offset + k] - max);
  return { arg, prob: 1 / sum };
}

/** Align token strings to character offsets in `text` (sequential search). */
export function alignTokens(text, tokens) {
  const out = [];
  let cursor = 0;
  // WordPiece marks continuations with "##"; BPE / SentencePiece mark word starts with "Ġ" / "▁"
  const bpe = tokens.some(t => /^[Ġ▁]/.test(t));
  for (const tok of tokens) {
    if (SPECIAL.test(tok)) { out.push(null); continue; }
    const piece = tok.replace(/^##/, '').replace(/^[Ġ▁]/, '');
    const wordStart = bpe ? /^[Ġ▁]/.test(tok) : !tok.startsWith('##');
    if (!piece) { out.push(null); continue; }
    let idx = text.indexOf(piece, cursor);
    if (idx < 0 || idx - cursor > 24) {
      const lower = text.toLowerCase().indexOf(piece.toLowerCase(), cursor);
      idx = lower >= 0 && lower - cursor <= 24 ? lower : -1;
    }
    if (idx < 0) { out.push(null); continue; }
    out.push({ start: idx, end: idx + piece.length, wordStart: wordStart || idx > cursor });
    cursor = idx + piece.length;
  }
  return out;
}

/** Group aligned + labeled tokens into words, then decode BIO into entities. */
export function decodeEntities(text, aligned, labels, probs) {
  const words = [];
  aligned.forEach((a, i) => {
    if (!a) return;
    const last = words[words.length - 1];
    if (!last || a.wordStart || a.start > last.end) {
      words.push({ start: a.start, end: a.end, label: labels[i], score: probs[i] });
    } else {
      last.end = a.end; // continuation piece: label comes from the first piece
    }
  });

  const entities = [];
  let cur = null;
  const close = () => { if (cur) { entities.push(cur); cur = null; } };
  for (const w of words) {
    const m = /^([BIES])-(.+)$/.exec(w.label || 'O');
    if (!m) { close(); continue; }
    const type = LABEL_ALIASES[m[2].toUpperCase()] || m[2].toUpperCase();
    if (cur && cur.label === type && (m[1] === 'I' || m[1] === 'E') && text.slice(cur.end, w.start).length <= 2) {
      cur.end = w.end;
      cur.scores.push(w.score);
    } else {
      close();
      cur = { start: w.start, end: w.end, label: type, scores: [w.score] };
    }
  }
  close();
  return entities.map(e => ({
    start: e.start,
    end: e.end,
    label: e.label,
    score: e.scores.reduce((a, b) => a + b, 0) / e.scores.length,
    text: text.slice(e.start, e.end),
  }));
}

/**
 * Run NER over one text. `tokenizer` and `model` are Transformers.js
 * AutoTokenizer / AutoModelForTokenClassification instances.
 */
export async function runNer(tokenizer, model, text) {
  const id2label = model.config.id2label;
  const entities = [];
  for (const chunk of chunkText(text)) {
    if (!/[A-Za-z]{2}/.test(chunk.text)) continue;
    const inputs = await tokenizer(chunk.text, { truncation: true, max_length: 512 });
    const { logits } = await model(inputs);
    const [, seqLen, numLabels] = logits.dims;
    const ids = Array.from(inputs.input_ids.data, Number);
    const tokens = tokenizer.model.convert_ids_to_tokens(ids);
    const labels = [];
    const probs = [];
    for (let t = 0; t < seqLen; t++) {
      const { arg, prob } = softmaxArgmax(logits.data, t * numLabels, numLabels);
      labels.push(id2label[arg]);
      probs.push(prob);
    }
    const aligned = alignTokens(chunk.text, tokens);
    for (const e of decodeEntities(chunk.text, aligned, labels, probs)) {
      entities.push({ ...e, start: e.start + chunk.offset, end: e.end + chunk.offset });
    }
  }
  return entities;
}
