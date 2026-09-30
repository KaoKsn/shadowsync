/**
 * Turn overlapping candidate spans into a final, non-overlapping set.
 *
 * 1. Same-type candidates that overlap are merged into their union (max score, all sources),
 *    so e.g. NER "Gurpreet Singh" + gazetteer "Gurpreet Singh Sandhu" never leaks "Sandhu".
 * 2. Spans fully contained in a longer passing span are dropped (the container wins).
 * 3. Remaining candidates are accepted greedily by score, then length, then type priority,
 *    skipping any that overlap an already-accepted span or fall below the type threshold.
 */

export const SENSITIVITY_THRESHOLDS = { low: 0.7, balanced: 0.5, high: 0.35 };

// Higher wins ties: specific validated identifiers beat generic ones
const TYPE_PRIORITY = {
  AADHAAR: 9, AADHAAR_VID: 9, GSTIN: 9, CREDIT_CARD: 9, PAN: 8, IMEI: 8, EMAIL: 8, UPI: 8, JWT_TOKEN: 8,
  AUTH_TOKEN: 8, API_KEY: 8, PASSWORD_HASH: 8, PHONE: 7, IFSC: 7, PASSPORT: 7, VOTER_ID: 7,
  DRIVER_LICENSE: 7, IP_ADDRESS: 6, DOB: 6, BANK_ACCOUNT: 5, ADDRESS: 4, NAME: 3, LOCATION: 2,
};

export function mergeSameType(spans) {
  const byType = new Map();
  for (const s of spans) {
    if (!byType.has(s.type)) byType.set(s.type, []);
    byType.get(s.type).push(s);
  }
  const merged = [];
  for (const list of byType.values()) {
    list.sort((a, b) => a.start - b.start || b.end - a.end);
    let cur = null;
    for (const s of list) {
      if (cur && s.start < cur.end) {
        cur.end = Math.max(cur.end, s.end);
        cur.score = Math.max(cur.score, s.score);
        for (const src of s.sources) if (!cur.sources.includes(src)) cur.sources.push(src);
        for (const r of s.reasons) if (!cur.reasons.includes(r)) cur.reasons.push(r);
      } else {
        if (cur) merged.push(cur);
        cur = { ...s, sources: [...s.sources], reasons: [...s.reasons] };
      }
    }
    if (cur) merged.push(cur);
  }
  return merged;
}

export function resolveSpans(candidates, { threshold = 0.5, typeThresholds = {} } = {}) {
  const passing = mergeSameType(candidates.map(c => ({ ...c, sources: c.sources || [c.source], reasons: c.reasons || [] })))
    .filter(c => c.end > c.start && c.score >= (typeThresholds[c.type] ?? threshold));
  // A span fully inside a longer passing span adds nothing and could otherwise win on score
  // and cause the rest of the container (e.g. an address around a PIN code) to leak.
  const pool = passing.filter(c => !passing.some(o => o !== c &&
    o.start <= c.start && c.end <= o.end && (o.end - o.start) > (c.end - c.start)));
  pool.sort((a, b) =>
    b.score - a.score ||
    (b.end - b.start) - (a.end - a.start) ||
    (TYPE_PRIORITY[b.type] || 0) - (TYPE_PRIORITY[a.type] || 0));

  const accepted = [];
  for (const c of pool) {
    if (accepted.some(a => c.start < a.end && a.start < c.end)) continue;
    accepted.push(c);
  }
  return accepted.sort((a, b) => a.start - b.start);
}
