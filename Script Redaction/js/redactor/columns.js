/**
 * Column-level inference for tabular data (HTML tables and CSV/TSV/pipe text).
 *
 * If most cells in a column are confidently one PII type (e.g. 4 of 5 are valid
 * phone numbers or recognised names), every cell in that column is treated as that
 * type, which catches the odd-format phone number or the name the model missed.
 */
import { runPatterns } from './patterns.js';
import { detectNames } from './names.js';
import { resolveLabel, isPlaceholder, isFieldKeyword } from './fields.js';

const MIN_CELLS = 3;
const MIN_SHARE = 0.6;
// Types that make sense column-wide (SECRET / free-text types are excluded on purpose)
const INFERABLE = new Set(['NAME', 'EMAIL', 'PHONE', 'AADHAAR', 'AADHAAR_VID', 'PAN', 'GSTIN', 'UPI', 'IFSC',
  'CREDIT_CARD', 'IP_ADDRESS', 'VEHICLE_REG', 'DRIVER_LICENSE', 'PASSPORT', 'VOTER_ID', 'IMEI', 'ADDRESS']);

/** Types that confidently cover (almost) the whole cell value. */
function cellTypes(value) {
  const v = value.trim();
  const types = new Set();
  const covers = (s) => s.score >= 0.5 && (s.end - s.start) >= 0.8 * v.length;
  for (const s of runPatterns(v)) if (covers(s)) types.add(s.type);
  for (const s of detectNames(v)) if (covers(s)) types.add('NAME');
  return types;
}

/**
 * Infer a column type from its cell values.
 * Returns { type, count, total } or null.
 */
export function inferColumnType(values) {
  const cells = values.map(v => String(v || '').trim()).filter(v => v && !isPlaceholder(v));
  if (cells.length < MIN_CELLS) return null;
  const counts = new Map();
  for (const v of cells) {
    for (const t of cellTypes(v)) if (INFERABLE.has(t)) counts.set(t, (counts.get(t) || 0) + 1);
  }
  let best = null;
  for (const [type, count] of counts) {
    if (count / cells.length >= MIN_SHARE && (!best || count > best.count)) best = { type, count, total: cells.length };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Delimited text (CSV / TSV / pipe tables pasted as text)
// ---------------------------------------------------------------------------
const DELIMITERS = [
  { ch: '\t', minCols: 2 },
  { ch: '|', minCols: 2 },
  { ch: ',', minCols: 3 }, // commas also appear in prose: require at least 3 columns
  { ch: ';', minCols: 3 },
];

function splitLines(text) {
  const lines = [];
  const re = /[^\n]*/g;
  let m;
  while ((m = re.exec(text))) {
    let line = m[0];
    if (line.endsWith('\r')) line = line.slice(0, -1);
    lines.push({ text: line, start: m.index });
    if (re.lastIndex >= text.length) break;
    re.lastIndex++;
  }
  return lines;
}

function splitCells(line, ch) {
  const cells = [];
  let start = 0;
  const parts = line.text.split(ch);
  for (const part of parts) {
    cells.push({ text: part, start: line.start + start });
    start += part.length + 1;
  }
  return cells;
}

/**
 * Detect a delimited table inside text and return candidate spans for PII columns.
 * Quoted CSV lines are skipped (simple splitting would misalign them).
 */
export function detectDelimitedTable(text) {
  if (!text.includes('\n')) return [];
  const lines = splitLines(text).filter(l => l.text.trim());
  let best = null;
  for (const { ch, minCols } of DELIMITERS) {
    const counts = new Map();
    for (const l of lines) {
      if (l.text.includes('"')) continue;
      const n = l.text.split(ch).length;
      if (n >= minCols) counts.set(n, (counts.get(n) || 0) + 1);
    }
    for (const [cols, count] of counts) {
      if (count >= MIN_CELLS && count >= 0.6 * lines.length && (!best || count > best.count)) best = { ch, cols, count };
    }
  }
  if (!best) return [];

  const rows = lines.filter(l => !l.text.includes('"') && l.text.split(best.ch).length === best.cols)
    .map(l => splitCells(l, best.ch));
  // A first row without digits is treated as a header
  const header = rows[0].every(c => !/\d/.test(c.text)) ? rows[0] : null;
  const body = header ? rows.slice(1) : rows;

  const spans = [];
  for (let col = 0; col < best.cols; col++) {
    const headerText = header ? header[col].text.trim() : '';
    const byHeader = headerText ? resolveLabel(headerText) : null;
    let type = null;
    let reason = '';
    if (byHeader && byHeader.mode === 'value') {
      type = byHeader.type;
      reason = `column header '${headerText}'`;
    } else {
      const inferred = inferColumnType(body.map(r => r[col].text));
      if (inferred) {
        type = inferred.type;
        reason = `column inference: ${inferred.count}/${inferred.total} cells are ${inferred.type}`;
      }
    }
    if (!type) continue;
    for (const row of body) {
      const cell = row[col];
      const value = cell.text.trim();
      if (!value || isPlaceholder(value) || isFieldKeyword(value)) continue;
      const start = cell.start + cell.text.indexOf(value);
      spans.push({ start, end: start + value.length, type, score: 0.9, source: 'column', reasons: [reason] });
    }
  }
  return spans;
}
