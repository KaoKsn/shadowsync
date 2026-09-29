/**
 * Declarative regex detectors. Each pattern yields candidate spans that are
 * validated (checksum / structure) and scored using nearby context words.
 *
 * Pattern fields:
 *   type, re (global), group      – what to match and which capture group is the value
 *   score                         – base confidence when the value validates
 *   validate(value)               – checksum / structural check
 *   invalidScore                  – if validation fails but a boost keyword is nearby, keep with this score
 *   requires                      – context keywords that MUST appear nearby (weak formats)
 *   boost / boostBy               – context keywords that raise confidence
 *   penalize                      – context keywords (before the match) that lower confidence by 0.5
 *   window                        – how many chars before the match to inspect (default 40)
 */
import * as V from './validators.js';

const NEG = ['order', 'order id', 'order no', 'invoice', 'inv', 'ref', 'reference', 'tracking', 'awb', 'txn',
  'transaction', 'utr', 'sku', 'part', 'part number', 'model', 'serial', 'batch', 'ticket', 'version', 'ver',
  'build', 'isbn', 'product', 'item', 'booking', 'pnr', 'receipt', 'challan', 'request', 'case'];
const PHONE_CTX = ['phone', 'mobile', 'mob', 'tel', 'telephone', 'call', 'cell', 'whatsapp', 'contact', 'reach',
  'reachable', 'fax', 'landline', 'sms', 'text', 'dial', 'ph', 'helpline'];
const CARD_CTX = ['card', 'credit', 'debit', 'visa', 'mastercard', 'amex', 'rupay', 'maestro', 'cc', 'charged', 'payment'];

const INDIAN_STATE_CODES = new Set(('AN AP AR AS BR CH CG CT DD DL DN GA GJ HR HP JK JH KA KL LA LD MP MH MN ML MZ NL OD ' +
  'OR PB PY RJ SK TN TS TR UP UK UA WB').split(' '));

export const INDIAN_PLACES = ['andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat',
  'haryana', 'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh', 'maharashtra', 'manipur',
  'meghalaya', 'mizoram', 'nagaland', 'odisha', 'orissa', 'punjab', 'rajasthan', 'sikkim', 'tamil nadu', 'telangana',
  'tripura', 'uttar pradesh', 'uttarakhand', 'west bengal', 'delhi', 'new delhi', 'jammu', 'kashmir', 'ladakh',
  'puducherry', 'pondicherry', 'chandigarh', 'mumbai', 'bombay', 'pune', 'bengaluru', 'bangalore', 'chennai',
  'madras', 'hyderabad', 'secunderabad', 'kolkata', 'calcutta', 'ahmedabad', 'surat', 'jaipur', 'lucknow', 'kanpur',
  'nagpur', 'indore', 'bhopal', 'patna', 'vadodara', 'ludhiana', 'agra', 'nashik', 'thane', 'navi mumbai',
  'coimbatore', 'kochi', 'cochin', 'thiruvananthapuram', 'trivandrum', 'visakhapatnam', 'vijayawada', 'mysuru',
  'mysore', 'mangaluru', 'mangalore', 'noida', 'gurugram', 'gurgaon', 'faridabad', 'ghaziabad', 'guwahati',
  'bhubaneswar', 'dehradun', 'ranchi', 'raipur', 'madurai', 'varanasi', 'amritsar', 'jodhpur', 'udaipur', 'rajkot'];

const STREET = String.raw`(?:Road|Rd|Street|St|Lane|Ln|Marg|Path|Nagar|Cross|Main|Avenue|Ave|Colony|Layout|Sector|Block|Phase|Apartments?|Apts?|Society|Towers?|Residency|Enclave|Complex|Chowk|Gali|Galli|Bazaar|Market|Circle|Extension|Extn|Vihar|Puram|Palya|Halli|Pet|Peth|Heights|Villas?|Gardens?|Park|Plaza|Building|Bldg|Floor|Wing|Mohalla|Wadi)`;
const CAP_TOKEN = String.raw`(?:\d{1,3}(?:st|nd|rd|th)\s+)?[A-Z][A-Za-z.'\-]*`;

const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;
const DATE = String.raw`(?:\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|\d{1,2}(?:st|nd|rd|th)?\s+${MONTH},?\s+\d{4}|${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})`;

const CHECK_LABELS_EXTRA = new Map();
const digitsBetween = (min, max) => {
  const fn = (v) => { const n = V.digitsOnly(v).length; return n >= min && n <= max; };
  CHECK_LABELS_EXTRA.set(fn, `${min}-${max} digits`);
  return fn;
};

export const PATTERNS = [
  // ---- Contact ----
  { type: 'EMAIL', re: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}\b/g, score: 0.95 },
  { type: 'UPI', re: /\b[A-Za-z0-9._\-]{2,64}@[A-Za-z]{2,32}\b(?![.@]\w)/g, validate: V.isUPI, score: 0.9,
    invalidScore: 0.75, boost: ['upi', 'vpa', 'gpay', 'google pay', 'phonepe', 'paytm', 'bhim', 'pay'] },
  { type: 'PHONE', re: /(?<![\w+])(?:(?:\+|00)?91[\s\-]?|0)?[6-9]\d{2}(?:[\s\-]?\d){7}(?!\w)/g,
    validate: V.isIndianMobile, score: 0.85, boost: PHONE_CTX, penalize: NEG },
  // Landlines with STD code: 080-2345 6789, (080) 2345 6789, +91 (80) 4123 4567
  { type: 'PHONE', re: /(?<![\w+(])(?:\+91[\s\-]?\(?0?|\(?0)\d{2,4}\)?[\s\-]\d{3,4}[\s\-]?\d{4}(?!\w)/g,
    validate: (v) => { const d = V.digitsOnly(v).replace(/^91/, '').replace(/^0/, ''); return d.length === 10; },
    check: 'STD landline format', score: 0.6, boost: PHONE_CTX, boostBy: 0.25, penalize: NEG },
  { type: 'PHONE', re: /(?<![\w+])(?:\+1[\s.\-]?)?\(\d{3}\)\s?\d{3}[\s.\-]\d{4}(?!\w)/g, score: 0.85, penalize: NEG },
  { type: 'PHONE', re: /(?<![\w+])(?:\+1[\s.\-]?)?\d{3}[\s.\-]\d{3}[\s.\-]\d{4}(?!\w)/g, score: 0.45,
    boost: PHONE_CTX, boostBy: 0.35, penalize: NEG },
  { type: 'PHONE', re: /(?<![\w+])\+(?!91|1\b)[1-9]\d{0,2}(?:[\s.\-]?\(?\d{1,5}\)?){2,5}(?!\w)/g,
    validate: digitsBetween(8, 15), score: 0.8, penalize: NEG },
  { type: 'PHONE', group: 1, validate: digitsBetween(7, 15), score: 0.8,
    re: /\b(?:phone|mobile|mob|tel|telephone|call|cell|whatsapp|contact|reach(?:able)?|fax)\b[^\d+\n]{0,15}([+(]?\d[\d\s().\-]{5,18}\d)(?!\w)/gi },

  // ---- Indian government identifiers ----
  { type: 'AADHAAR', re: /(?<!\d[ \-]?)[2-9]\d{3}([ \-]?)\d{4}\1\d{4}(?![ \-]?\d)/g, validate: V.isAadhaar,
    score: 0.95, invalidScore: 0.7, boost: ['aadhaar', 'aadhar', 'uid', 'uidai', 'ekyc', 'e-kyc'], penalize: NEG },
  { type: 'AADHAAR_VID', re: /(?<!\d[ \-]?)\d{4}([ \-]?)\d{4}\1\d{4}\1\d{4}(?![ \-]?\d)/g, validate: V.isAadhaarVID,
    score: 0.8, boost: ['vid', 'virtual id', 'aadhaar', 'aadhar'], penalize: NEG },
  { type: 'PAN', re: /\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b/g, score: 0.9, boost: ['pan'], penalize: NEG },
  { type: 'GSTIN', re: /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]\b/g, validate: V.isGSTIN, score: 0.97,
    invalidScore: 0.7, boost: ['gst', 'gstin'] },
  { type: 'IFSC', re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g, score: 0.85, boost: ['ifsc', 'bank', 'branch'] },
  { type: 'VOTER_ID', re: /\b[A-Z]{3}\d{7}\b/g, score: 0.9, requires: ['voter', 'epic', 'election'] },
  { type: 'PASSPORT', re: /\b[A-PR-WY][1-9]\d\s?\d{4}[1-9]\b/g, score: 0.9, requires: ['passport'] },
  { type: 'PASSPORT', re: /\b[A-Z]{1,2}\d{6,9}\b/g, score: 0.85, requires: ['passport'], window: 30 },
  { type: 'DRIVER_LICENSE', re: /\b([A-Z]{2})[\-\s]?\d{2}[\-\s]?(?:19|20)\d{2}\s?\d{7}\b/g,
    validate: (v) => INDIAN_STATE_CODES.has(v.slice(0, 2)), check: 'Indian state code', score: 0.7,
    boost: ['licence', 'license', 'dl', 'driving'], boostBy: 0.25 },
  { type: 'VEHICLE_REG', re: /\b[A-Z]{2}[\-\s]?\d{1,2}[\-\s]?[A-Z]{1,3}[\-\s]?\d{4}\b/g,
    validate: (v) => INDIAN_STATE_CODES.has(v.slice(0, 2)), check: 'Indian state code', score: 0.55,
    boost: ['vehicle', 'registration', 'reg', 'car', 'bike', 'scooter', 'number plate', 'registered'], boostBy: 0.3,
    penalize: NEG },
  { type: 'VEHICLE_REG', re: /\b\d{2}\s?BH\s?\d{4}\s?[A-Z]{1,2}\b/g, score: 0.8 },

  // ---- Financial ----
  { type: 'CREDIT_CARD', re: /(?<!\d[ \-]?)(?:\d[ \-]?){12,18}\d(?![ \-]?\d)/g, validate: V.isCreditCard,
    score: 0.95, invalidScore: 0.65, boost: CARD_CTX, penalize: NEG },
  { type: 'CREDIT_CARD', re: /(?:[xX*•]{4}[ \-]?){2,3}\d{4}\b/g, score: 0.85 },
  { type: 'CREDIT_CARD', group: 1, score: 0.85,
    re: /\b(?:card|visa|mastercard|amex|rupay|maestro)\b[^.\n\d]{0,20}?(?:ending|last\s*4(?:\s*digits)?)\s*(?:in|with|:)?\s*(\d{4})\b/gi },
  { type: 'CVV', group: 1, score: 0.9,
    re: /\b(?:cvv2?|cvc2?|cvn|security\s*code|card\s*verification(?:\s*(?:value|code))?)\b\s*(?:no\.?|number|#)?\s*[:=\-]?\s*(\d{3,4})\b/gi },
  { type: 'EXPIRY', group: 1, score: 0.85,
    re: /\b(?:exp(?:iry|iration)?(?:\s*date)?|valid\s*(?:thru|through|till|upto|until))\b\.?\s*[:=\-]?\s*((?:0[1-9]|1[0-2])\s?\/\s?(?:\d{4}|\d{2}))(?!\d)/gi },
  { type: 'BANK_ACCOUNT', re: /(?<![\w\-])\d{9,18}(?![\w\-])/g, score: 0.85, window: 32,
    requires: ['account', 'a/c', 'acct', 'acc', 'ac', 'savings', 'beneficiary', 'bank'], penalize: NEG },
  { type: 'BANK_ACCOUNT', group: 1, score: 0.85, re: /\b(?:customer\s*account|account)\s*#\s*([A-Z0-9\-]{6,16})\b/gi },
  { type: 'PIN', group: 1, score: 0.85,
    re: /\b(?:atm\s*pin|m-?pin|upi\s*pin|security\s*pin|recovery\s*pin|account\s*pin|otp|one[\- ]time\s*password|pin)\b\s*(?:is|no\.?|number)?\s*[:=\-]?\s*(\d{4,8})\b/gi },

  // ---- Location ----
  { type: 'PINCODE', re: /(?<![\w\-])[1-9]\d{2}\s?\d{3}(?![\w\-])/g, validate: V.isIndianPincode, score: 0.8,
    window: 30, requires: ['pin', 'pincode', 'pin code', 'postal', 'zip', 'post', ...INDIAN_PLACES] },
  { type: 'ADDRESS', score: 0.75, boost: ['address', 'residing', 'resides', 'resident', 'deliver', 'delivery', 'ship',
    'lives', 'located', 'r/o', 'residence', 'stay', 'stays'],
    re: new RegExp(String.raw`\b(?:(?:Flat|House|Door|Plot|Apt|Apartment|Room|Shop|Unit|H\.?\s?No|D\.?\s?No|No)\.?\s*(?:No\.?\s*)?)?#?\d{1,5}[A-Za-z]?(?:\s?[\/\-]\s?\d{1,5}[A-Za-z]?)*,?\s+(?:${CAP_TOKEN},?\s+){0,5}?${STREET}(?:\s+${STREET})*\b(?:,\s*${CAP_TOKEN}(?:\s+[A-Z][A-Za-z.'\-]*){0,3}){0,6}(?:,?\s*(?:-\s*)?[1-9]\d{2}\s?\d{3}(?!\d))?`, 'g') },

  // ---- Dates of birth (only with birth context right before the date) ----
  { type: 'DOB', re: new RegExp(DATE, 'gi'), validate: V.isDate, score: 0.9, window: 24,
    requires: ['dob', 'd.o.b', 'date of birth', 'birth', 'born', 'birthday', 'b\'day'] },

  // ---- Network & secrets ----
  { type: 'IP_ADDRESS', re: /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g, validate: V.isIPv4, score: 0.85,
    penalize: [...NEG, 'v', 'release', 'firmware', 'upgrade', 'update', 'sdk', 'app', 'patch'] },
  { type: 'IP_ADDRESS', re: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g, score: 0.85 },
  { type: 'IP_ADDRESS', re: /(?<![\w:])(?:[0-9a-fA-F]{1,4}:){1,6}:(?:[0-9a-fA-F]{1,4}:?){1,6}(?![\w:])/g,
    validate: (v) => v.includes('::') && v.split(':').filter(Boolean).length >= 3, check: 'IPv6 form', score: 0.8 },
  { type: 'MAC_ADDRESS', re: /\b(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}\b/g, score: 0.8 },
  { type: 'IMEI', re: /(?<!\d)\d{15}(?!\d)|\b\d{2}-\d{6}-\d{6}-\d\b/g, validate: V.isIMEI, score: 0.9,
    requires: ['imei', 'device', 'handset', 'serial', 'phone', 'mobile'] },
  { type: 'API_KEY', re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, score: 0.95 },
  { type: 'API_KEY', re: /\brzp_(?:live|test)_[A-Za-z0-9]{14,}\b/g, score: 0.95 },
  { type: 'API_KEY', re: /\b(?:AKIA|ASIA|AROA)[0-9A-Z]{16}\b/g, score: 0.95 },
  { type: 'API_KEY', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, score: 0.95 },
  { type: 'API_KEY', re: /\bxox[abprs]-[A-Za-z0-9\-]{10,}\b/g, score: 0.95 },
  { type: 'API_KEY', re: /\bAIza[0-9A-Za-z_\-]{35}\b/g, score: 0.95 },
  { type: 'API_KEY', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{20,}\b/g, score: 0.9 },
  { type: 'PRIVATE_KEY', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g, score: 0.99 },
  { type: 'AUTH_TOKEN', re: /\beyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*/g, validate: V.isJWT, score: 0.95 },
  { type: 'AUTH_TOKEN', group: 1, re: /\bBearer\s+([A-Za-z0-9\-._~+\/]{16,}=*)/g, score: 0.9 },
  { type: 'API_KEY', group: 1, score: 0.9,
    re: /\b(?:api[_\-]?key|api[_\-]?secret|access[_\-]?token|secret[_\-]?key|client[_\-]?secret|auth[_\-]?token|private[_\-]?key)\b["']?\s*[:=]\s*["']?([^\s"',;]{8,})/gi },
  { type: 'PASSWORD', group: 1, score: 0.9, re: /\b(?:password|passwd|pwd)\b["']?\s*[:=]\s*["']?([^\s"',;]{4,})/gi },
  { type: 'PASSWORD_HASH', re: /\$2[abxy]?\$\d{2}\$[A-Za-z0-9.\/]{20,}/g, score: 0.95 },
  { type: 'PASSWORD_HASH', re: /\$argon2(?:id|i|d)\$[A-Za-z0-9$=+,.\/]{20,}/g, score: 0.95 },

  // ---- Health ----
  { type: 'MRN', group: 1, validate: (v) => /\d/.test(v), check: 'contains digits', score: 0.9,
    re: /\b(?:MRN|UHID|[Mm]edical\s+[Rr]ecord(?:\s*(?:[Nn]o\.?|[Nn]umber|#))?|[Pp]atient\s*(?:ID|[Ii]d|[Nn]o\.?|[Nn]umber))\s*[:#=\-]?\s*([A-Z0-9][A-Z0-9\-]{3,14})\b/g },
  { type: 'MEDICAL_CONDITION', group: 1, score: 0.8,
    re: /\b(?:[Dd]iagnosed with|[Ss]uffering from|[Tt]reated for|[Tt]reatment (?:for|of)|[Hh]istory of|[Aa]dmitted (?:for|with)|[Pp]ositive for|[Cc]omplains? of|[Pp]rescribed \w+ for)\s+([A-Za-z0-9][A-Za-z0-9'\- ]{2,40}?)(?=\s+(?:in|since|on|at|and|with|for|from|by|was|is|last)\b|[.,;:)\n]|$)/g },
  { type: 'BLOOD_GROUP', group: 1, score: 0.85,
    re: /\b[Bb]lood\s*(?:[Gg]roup|[Tt]ype)\s*(?:is)?\s*[:=\-]?\s*((?:AB|A|B|O)\s?(?:[+\-](?:ve)?|[Pp]ositive|[Nn]egative))(?![\w+\-])/g },
];

// ---------------------------------------------------------------------------
// Context scoring
// ---------------------------------------------------------------------------
const kwCache = new WeakMap();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function kwRegex(list) {
  if (!kwCache.has(list)) {
    kwCache.set(list, new RegExp(`(?:^|[^a-z0-9])(${list.map(escapeRe).join('|')})(?=$|[^a-z0-9])`));
  }
  return kwCache.get(list);
}

/** The first keyword from `list` found in `ctx`, or null. */
function findKeyword(list, ctx) {
  const m = kwRegex(list).exec(ctx);
  return m ? m[1] : null;
}

// Human-readable names for validators, used in explanations
const CHECK_LABELS = new Map([
  [V.isAadhaar, 'Verhoeff checksum'], [V.isAadhaarVID, 'Verhoeff checksum'], [V.isCreditCard, 'Luhn + card IIN'],
  [V.isIMEI, 'Luhn checksum'], [V.isGSTIN, 'GSTIN checksum'], [V.isUPI, 'known UPI handle'],
  [V.isIndianMobile, 'Indian mobile format'], [V.isIndianPincode, 'PIN code format'], [V.isIPv4, 'valid IPv4'],
  [V.isJWT, 'JWT header decodes'], [V.isDate, 'real calendar date'],
]);
const checkLabel = (p) => p.check || CHECK_LABELS.get(p.validate) || CHECK_LABELS_EXTRA.get(p.validate) || 'format check';

const ABBREVIATIONS = new Set(['no', 'dr', 'mr', 'mrs', 'ms', 'rs', 'st', 'sr', 'jr', 'co', 'ltd', 'inc', 'vs', 'etc',
  'prof', 'smt', 'sh', 'acc', 'ph', 'mob', 'tel', 'dt', 'reg', 'approx', 'e.g', 'i.e', 'a/c', 'govt', 'dept', 'ref']);

/** Text before `start`, limited to `size` chars and clipped at the last sentence boundary. */
export function contextBefore(text, start, size) {
  const before = text.slice(Math.max(0, start - size), start);
  let cut = 0;
  const re = /(\S*)[.!?]\s+|[;\n|]\s*/g;
  let m;
  while ((m = re.exec(before))) {
    const word = (m[1] || '').toLowerCase();
    if (m[1] !== undefined && m[0][m[1].length] === '.' && (ABBREVIATIONS.has(word) || /^[a-z]$/.test(word))) continue;
    cut = m.index + m[0].length;
  }
  return before.slice(cut);
}

export function contextAfter(text, end, size) {
  const after = text.slice(end, end + size);
  const m = /[.!?]\s|[;\n|]/.exec(after);
  return m ? after.slice(0, m.index) : after;
}

/**
 * Run all patterns over text. `hint` is extra context (e.g. a form label or table
 * column header) treated as if it appeared right before every match.
 */
export function runPatterns(text, { hint = '' } = {}) {
  const spans = [];
  const hintLower = hint.toLowerCase();
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text))) {
      if (m[0].length === 0) { p.re.lastIndex++; continue; }
      const g = p.group || 0;
      const value = m[g];
      if (!value) continue;
      const start = m.index + (g ? m[0].indexOf(value) : 0);
      const end = start + value.length;

      const before = contextBefore(text, m.index, p.window || 40).toLowerCase();
      const ctx = `${hintLower} ${before} ${contextAfter(text, m.index + m[0].length, 20).toLowerCase()}`;
      const reasons = [`${p.type.toLowerCase()} pattern (base ${p.score})`];
      if (p.requires) {
        const kw = findKeyword(p.requires, ctx);
        if (!kw) continue;
        reasons.push(`required context '${kw}' present`);
      }
      const boostKw = p.boost ? findKeyword(p.boost, ctx) : null;

      let score = p.score;
      if (p.validate && !p.validate(value)) {
        if (p.invalidScore && boostKw) {
          score = p.invalidScore;
          reasons.push(`${checkLabel(p)} failed, kept because of context '${boostKw}'`);
        } else continue;
      } else {
        if (p.validate) reasons.push(`${checkLabel(p)} passed`);
        if (boostKw) {
          score += p.boostBy || 0.15;
          reasons.push(`context '${boostKw}' +${p.boostBy || 0.15}`);
        }
      }
      const penaltyKw = p.penalize ? findKeyword(p.penalize, `${hintLower} ${contextBefore(text, m.index, 24).toLowerCase()}`) : null;
      if (penaltyKw) {
        score -= 0.5;
        reasons.push(`context '${penaltyKw}' -0.5`);
      }
      spans.push({ start, end, type: p.type, score: Math.min(score, 0.99), source: 'regex', reasons });
    }
  }
  spans.push(...detectSecrets(text, hintLower));
  return spans;
}

// ---------------------------------------------------------------------------
// High-entropy secrets (unknown API keys / tokens), in the spirit of gitleaks/trufflehog
// ---------------------------------------------------------------------------
const SECRET_CTX = ['key', 'api', 'apikey', 'secret', 'token', 'password', 'passwd', 'pwd', 'auth', 'credential',
  'credentials', 'bearer', 'private', 'access', 'signature', 'sig', 'session', 'cookie', 'client_secret'];
const SECRET_NEG = [...NEG, 'id', 'uuid', 'guid', 'hash', 'sha', 'sha1', 'sha256', 'md5', 'commit', 'checksum',
  'nonce', 'etag', 'digest', 'file', 'filename', 'image', 'img', 'class'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function shannonEntropy(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function detectSecrets(text, hintLower = '') {
  const spans = [];
  // '=' may follow a value (base64 padding) but may precede it too (KEY=value), so it is not in the lookbehind
  const re = /(?<![A-Za-z0-9_\-+\/])[A-Za-z0-9_\-+\/]{16,}={0,2}(?![A-Za-z0-9_\-+\/=])/g;
  let m;
  while ((m = re.exec(text))) {
    const value = m[0];
    if (UUID.test(value) || (value.match(/\//g) || []).length > 1) continue;
    // Part of a URL path (but query values like ?token=... are still checked)
    const wordStart = text.lastIndexOf(' ', m.index) + 1;
    const word = text.slice(wordStart, m.index);
    if (word.includes('://') && !/[?&][^=]*=$/.test(word)) continue;

    const classes = [/[a-z]/, /[A-Z]/, /\d/].filter(r => r.test(value)).length;
    const entropy = shannonEntropy(value);
    const ctx = `${hintLower} ${contextBefore(text, m.index, 30).toLowerCase()}`;
    const kw = findKeyword(SECRET_CTX, ctx);

    let score;
    const reasons = [`high-entropy token (${entropy.toFixed(1)} bits/char, ${value.length} chars)`];
    if (classes === 3 && value.length >= 20 && entropy >= 3.5) score = 0.6;
    else if (kw && classes >= 2 && entropy >= 3.0) score = 0.55;
    else continue;
    if (kw) {
      score += 0.3;
      reasons.push(`context '${kw}' +0.3`);
    }
    const neg = findKeyword(SECRET_NEG, `${hintLower} ${contextBefore(text, m.index, 24).toLowerCase()}`);
    if (neg) {
      score -= 0.5;
      reasons.push(`context '${neg}' -0.5`);
    }
    spans.push({ start: m.index, end: m.index + value.length, type: 'SECRET', score, source: 'entropy', reasons });
  }
  return spans;
}
