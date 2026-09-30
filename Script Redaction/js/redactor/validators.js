/**
 * Checksum and structural validators for PII candidates.
 * All functions are pure and accept the raw matched string (separators allowed).
 */

export const digitsOnly = (s) => String(s || '').replace(/\D/g, '');

// ---------------------------------------------------------------------------
// Luhn (credit/debit cards, IMEI)
// ---------------------------------------------------------------------------
export function luhn(str) {
  const d = digitsOnly(str);
  if (!d) return false;
  let sum = 0;
  let dbl = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (dbl) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

// Known card IIN prefixes (Visa, Mastercard, Amex, Discover, Diners, JCB, RuPay, Maestro)
const CARD_IIN = /^(?:4|5[1-5]|2(?:2[2-9]|[3-6]\d|7[01]|720)|3[47]|3(?:0[0-5]|[68])|35(?:2[89]|[3-8]\d)|6011|64[4-9]|65|60|81|82|508|50|5[6-9]|6[37])/;

export function isCreditCard(str) {
  const d = digitsOnly(str);
  if (d.length < 13 || d.length > 19) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  return CARD_IIN.test(d) && luhn(d);
}

export function isIMEI(str) {
  const d = digitsOnly(str);
  return d.length === 15 && !/^(\d)\1+$/.test(d) && luhn(d);
}

// ---------------------------------------------------------------------------
// Verhoeff (Aadhaar, Aadhaar VID)
// ---------------------------------------------------------------------------
const V_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const V_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 2, 4, 1],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const V_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeff(str) {
  const d = digitsOnly(str);
  if (!d) return false;
  let c = 0;
  for (let i = 0; i < d.length; i++) {
    c = V_D[c][V_P[i % 8][d.charCodeAt(d.length - 1 - i) - 48]];
  }
  return c === 0;
}

/** Compute the Verhoeff check digit for a digit string (used to build test data). */
export function verhoeffCheckDigit(str) {
  const d = digitsOnly(str);
  let c = 0;
  for (let i = 0; i < d.length; i++) {
    c = V_D[c][V_P[(i + 1) % 8][d.charCodeAt(d.length - 1 - i) - 48]];
  }
  return V_INV[c];
}

export function isAadhaar(str) {
  const d = digitsOnly(str);
  if (d.length !== 12 || !/^[2-9]/.test(d)) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  return verhoeff(d);
}

export function isAadhaarVID(str) {
  const d = digitsOnly(str);
  return d.length === 16 && !/^(\d)\1+$/.test(d) && verhoeff(d);
}

// ---------------------------------------------------------------------------
// PAN / GSTIN / IFSC / other Indian identifiers
// ---------------------------------------------------------------------------
export const PAN_RE = /^[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]$/;

export function isPAN(str) {
  return PAN_RE.test(String(str || '').toUpperCase().replace(/\s/g, ''));
}

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GST_CHARS.indexOf(first14[i]);
    if (v < 0) return null;
    const prod = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36];
}

export function isGSTIN(str) {
  const s = String(str || '').toUpperCase().replace(/\s/g, '');
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]$/.test(s)) return false;
  const state = parseInt(s.slice(0, 2), 10);
  if (!((state >= 1 && state <= 38) || state === 97 || state === 99)) return false;
  if (!isPAN(s.slice(2, 12))) return false;
  return gstinCheckChar(s.slice(0, 14)) === s[14];
}

export function isIFSC(str) {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(str || '').toUpperCase());
}

export function isIndianMobile(str) {
  let d = digitsOnly(str);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length !== 10 || !/^[6-9]/.test(d)) return false;
  return !/^(\d)\1+$/.test(d);
}

export function isIndianPincode(str) {
  return /^[1-9]\d{5}$/.test(digitsOnly(str)) && digitsOnly(str).length === 6;
}

// Common UPI handles (PSP suffixes). Emails always have a dot after '@'; UPI handles do not.
export const UPI_HANDLES = new Set([
  'upi', 'ybl', 'ibl', 'axl', 'paytm', 'ptyes', 'ptaxis', 'pthdfc', 'ptsbi', 'okaxis', 'okhdfcbank', 'okicici',
  'oksbi', 'apl', 'yapl', 'rapl', 'abfspay', 'axisbank', 'axisb', 'icici', 'hdfcbank', 'sbi', 'kotak', 'kmbl',
  'freecharge', 'jupiteraxis', 'fam', 'slc', 'waicici', 'waaxis', 'wahdfcbank', 'wasbi', 'idfcbank', 'idfcfirst',
  'pnb', 'barodampay', 'unionbank', 'indus', 'federal', 'yesbank', 'airtel', 'jio', 'mahb', 'aubank', 'dbs',
  'rbl', 'citi', 'hsbc', 'sc', 'boi', 'cnrb', 'ikwik', 'timecosmos', 'naviaxis', 'superyes', 'pingpay',
]);

export function isUPI(str) {
  const m = /^([A-Za-z0-9._-]{2,256})@([A-Za-z]{2,64})$/.exec(String(str || ''));
  return Boolean(m) && UPI_HANDLES.has(m[2].toLowerCase());
}

// ---------------------------------------------------------------------------
// Network / tokens
// ---------------------------------------------------------------------------
export function isIPv4(str) {
  const parts = String(str || '').split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255 && !(p.length > 1 && p[0] === '0'));
}

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  if (typeof atob === 'function') return atob(padded);
  return Buffer.from(padded, 'base64').toString('binary');
}

export function isJWT(str) {
  const parts = String(str || '').split('.');
  if (parts.length < 2) return false;
  try {
    const header = JSON.parse(b64urlDecode(parts[0]));
    return Boolean(header && typeof header === 'object' && header.alg);
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function isRealDate(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2100)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const expandYear = (y) => (y < 100 ? (y > 30 ? 1900 + y : 2000 + y) : y);

/**
 * Validate a date string in common formats. Numeric dates are read day-first
 * (Indian convention) with a month-first fallback.
 */
export function isDate(str) {
  const s = String(str || '').trim();
  let m = /^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/.exec(s);
  if (m) return isRealDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const y = expandYear(+m[3]);
    return isRealDate(y, +m[2], +m[1]) || isRealDate(y, +m[1], +m[2]);
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mi >= 0 && isRealDate(+m[3], mi + 1, +m[1]);
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return mi >= 0 && isRealDate(+m[3], mi + 1, +m[2]);
  }
  return false;
}
