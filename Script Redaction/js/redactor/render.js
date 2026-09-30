/** Replacement text for a redacted value. */
export function formatTag(type, style, original = '') {
  const val = String(original || '');
  if (style === 'blackout') return '█'.repeat(Math.max(val.length, 6));
  if (style === 'mask') {
    const digits = val.replace(/\D/g, '');
    // Keep the last 4 digits for long numeric identifiers (cards, accounts, phones)
    if (digits.length >= 8) return '•••• ' + digits.slice(-4);
    return '••••';
  }
  return `[REDACTED_${type}]`;
}

/** Apply non-overlapping spans to text, right to left so earlier offsets stay valid. */
export function applySpans(text, spans, style) {
  let out = text;
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  for (const s of ordered) {
    out = out.slice(0, s.start) + formatTag(s.type, style, text.slice(s.start, s.end)) + out.slice(s.end);
  }
  return out;
}
