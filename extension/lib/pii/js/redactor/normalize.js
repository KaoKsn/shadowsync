/**
 * Normalize text for detection while keeping a map back to original offsets.
 * - NFKC folds full-width digits/letters and compatibility forms ("１２３" -> "123").
 * - Zero-width and soft-hyphen characters (a common obfuscation trick) are dropped.
 * - Non-breaking and exotic spaces become plain spaces.
 */
const INVISIBLE = /[­​-‍⁠﻿]/;
const EXOTIC_SPACE = /[   -   　]/;

export function normalizeWithMap(text) {
  let out = '';
  const map = []; // map[i] = index in original of normalized char i
  let i = 0;
  for (const ch of text) {
    const len = ch.length;
    if (!INVISIBLE.test(ch)) {
      const n = EXOTIC_SPACE.test(ch) ? ' ' : ch.normalize('NFKC');
      for (let k = 0; k < n.length; k++) map.push(i);
      out += n;
    }
    i += len;
  }
  map.push(text.length);
  return { text: out, map };
}

/** Map a [start, end) range on normalized text back to the original string. */
export function mapRange(map, start, end, originalText) {
  const s = map[start];
  // end is exclusive: take the original index of the last included char and step past it
  const lastOrig = map[Math.max(start, end - 1)];
  const cp = originalText.codePointAt(lastOrig);
  const e = end > start ? lastOrig + (cp > 0xffff ? 2 : 1) : s;
  return [s, e];
}
