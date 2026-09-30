/**
 * Field labels -> PII types, and "Label: value" extraction.
 *
 * Label matching is strict: the label must consist of a known keyword plus only
 * qualifier / filler words ("Registered mobile no." -> PHONE), so that
 * "Product name" or "Transaction ID" never cause their values to be redacted.
 */
import { isDate } from './validators.js';

// mode 'value' = redact the whole value; 'hint' = only give context to the pattern detectors
export const FIELD_MAPPINGS = [
  { type: 'NAME', kw: ['name', 'full name', 'first name', 'last name', 'middle name', 'surname', 'given name', 'maiden name', "mother's maiden name", "father's name", "mother's name", 'spouse name', "husband's name", "wife's name", 'guardian name', 'guardian', 'nominee', 'nominee name', 'account holder', 'account holder name', 'account owner', 'customer name', 'patient name', 'cardholder name', 'card holder name', 'applicant name', 'employee name', 'beneficiary', 'beneficiary name', 'contact person', 'emergency contact name', 'next of kin', 'insured name', 'policy holder'] },
  { type: 'DOB', kw: ['date of birth', 'dob', 'd.o.b', 'birth date', 'birthdate', 'birthday'] },
  { type: 'SENSITIVE_ATTRIBUTE', kw: ['age', 'gender', 'sex', 'nationality', 'marital status', 'religion', 'caste', 'ethnicity', 'race', 'sexual orientation', 'gender identity'] },
  { type: 'LOCATION', kw: ['place of birth', 'birth place', 'city', 'district', 'state', 'locality', 'village', 'taluk', 'tehsil', 'town'] },
  { type: 'ADDRESS', kw: ['address', 'home address', 'permanent address', 'current address', 'present address', 'correspondence address', 'residential address', 'shipping address', 'billing address', 'street address', 'mailing address', 'deliver to', 'ship to', 'house number', 'house no', 'flat no', 'street', 'residence'] },
  { type: 'PINCODE', kw: ['pincode', 'pin code', 'postal code', 'zip', 'zip code', 'postcode', 'post code'] },
  { type: 'AADHAAR', kw: ['aadhaar', 'aadhar', 'aadhaar card', 'uid', 'uidai', 'uid number'] },
  { type: 'AADHAAR_VID', kw: ['virtual id', 'vid', 'aadhaar vid'] },
  { type: 'PAN', kw: ['pan', 'pan number', 'pan card', 'pan card number', 'permanent account number'] },
  { type: 'GSTIN', kw: ['gstin', 'gst', 'gst number', 'gstin/uin', 'gst registration number'] },
  { type: 'TAX_ID', kw: ['tax id', 'tin', 'tan', 'ein', 'tax identification number'] },
  { type: 'VOTER_ID', kw: ['voter id', 'epic', 'epic number', 'voter identification number', 'election card', 'voter card'] },
  { type: 'DRIVER_LICENSE', kw: ['driving licence', 'driving license', "driver's licence", "driver's license", 'driver license', 'drivers license', 'dl', 'dl number', 'licence number', 'license number', 'licence', 'license'] },
  { type: 'PASSPORT', kw: ['passport', 'passport number'] },
  { type: 'EMAIL', kw: ['email', 'e-mail', 'email address', 'email id', 'mail id', 'mail'] },
  { type: 'PHONE', kw: ['phone', 'phone number', 'mobile', 'mobile number', 'mobile phone', 'telephone', 'tel', 'contact number', 'contact no', 'cell', 'cell phone', 'whatsapp', 'whatsapp number', 'landline', 'fax', 'direct line', 'emergency contact number'] },
  { type: 'UPI', kw: ['upi', 'upi id', 'vpa', 'upi handle'] },
  { type: 'BANK_ACCOUNT', kw: ['bank account', 'bank account number', 'account number', 'account no', 'a/c', 'a/c no', 'acct', 'acct no', 'savings account', 'checking account', 'current account'] },
  { type: 'IFSC', kw: ['ifsc', 'ifsc code'] },
  { type: 'ROUTING_NUMBER', kw: ['routing number', 'routing', 'aba', 'aba routing', 'routing transit number'] },
  { type: 'CREDIT_CARD', kw: ['card number', 'credit card', 'debit card', 'credit card number', 'debit card number'] },
  { type: 'PAYMENT_SECURITY', mode: 'hint', kw: ['card expiry', 'expiry', 'expiry date', 'expiration date', 'cvv', 'cvc', 'cvv2', 'security code', 'card expiry / cvv'] },
  { type: 'MRN', kw: ['medical record number', 'medical record', 'mrn', 'uhid', 'patient id', 'patient number', 'ip number', 'op number'] },
  { type: 'INSURANCE_PROVIDER', kw: ['insurance provider', 'insurer', 'insurance company', 'tpa'] },
  { type: 'POLICY', kw: ['policy number', 'policy id', 'policy no', 'member id', 'insurance id', 'group number', 'group #', 'policy id / group #'] },
  { type: 'MEDICAL_CONDITION', kw: ['diagnosis', 'condition', 'medical condition', 'medical history', 'allergies', 'allergy', 'known allergies', 'drug allergies', 'medications', 'medication', 'prescription', 'prescriptions', 'prescription medications', 'current medications', 'chief complaint'] },
  { type: 'BLOOD_GROUP', kw: ['blood group', 'blood type'] },
  { type: 'USERNAME', kw: ['username', 'user name', 'login', 'login id', 'login name', 'user id', 'userid', 'handle'] },
  { type: 'PASSWORD', kw: ['password', 'passwd', 'pwd', 'password hash', 'secret answer', 'security answer', 'secret question answer', 'security question answer'] },
  { type: 'PIN', kw: ['pin', 'atm pin', 'account pin', 'security pin', 'recovery pin', 'account recovery pin', 'mpin', 'otp', 'pin number'] },
  { type: 'API_KEY', kw: ['api key', 'api secret', 'secret key', 'access key', 'auth key', 'api auth key', 'live api auth key', 'access token', 'auth token', 'client secret', 'private key', 'token', 'secret'] },
  { type: 'IP_ADDRESS', mode: 'hint', kw: ['ip', 'ip address', 'login ip', 'last login ip', 'ip address (last login)'] },
  { type: 'IMEI', kw: ['imei', 'imei number'] },
  { type: 'VEHICLE_REG', kw: ['vehicle number', 'vehicle registration', 'vehicle registration number', 'vehicle no', 'registration number', 'reg no', 'number plate'] },
  { type: 'BIOMETRIC', kw: ['biometric', 'fingerprint', 'face scan', 'iris scan', 'retina scan'] },
  { type: 'IDENTIFIER', kw: ['customer id', 'employee id', 'employee code', 'emp id', 'student id', 'roll number', 'roll no', 'usn', 'university registration number', 'enrollment number', 'enrolment number', 'membership number', 'ration card', 'ration card number', 'national id', 'government id', 'ssn', 'social security number'] },
];

// Words that may surround a keyword in a label without changing its meaning
const QUALIFIERS = new Set(('full first last middle customer client patient user applicant employee student member ' +
  'holder account primary secondary alternate alternative registered home work office personal official permanent ' +
  'current present residential communication correspondence contact emergency your my his her their father\'s ' +
  'mother\'s spouse nominee guardian beneficiary card bank new old verified linked e details detail info ' +
  'no no. num number # of the for and & is id code ph mob').split(/\s+/));

const PLACEHOLDERS = /^(?:n\/?a|na|nil|none|null|nothing|-+|—|not (?:provided|available|applicable|given|disclosed)|same as (?:above|permanent|current).*|x{3,}|\*{3,}|\?+|tbd|unknown|pending|\[redacted[^\]]*\])$/i;

function cleanLabel(label) {
  return String(label || '').toLowerCase().replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim()
    .replace(/^[\s*•\-–—]+/, '').replace(/[\s:：#=\-–—.*]+$/, '');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYWORD_INDEX = FIELD_MAPPINGS.flatMap(m => m.kw.map(kw => ({
  kw, mapping: m, re: new RegExp(`(?:^|[^a-z0-9'])${escapeRe(kw)}(?=$|[^a-z0-9'])`),
}))).sort((a, b) => b.kw.length - a.kw.length);

/** Map a label ("Registered Mobile No.:") to { type, mode } or null. */
export function resolveLabel(label) {
  const clean = cleanLabel(label);
  if (!clean || clean.length > 48) return null;
  for (const { kw, mapping, re } of KEYWORD_INDEX) {
    const m = re.exec(clean);
    if (!m) continue;
    const idx = m.index + m[0].indexOf(kw);
    const rest = (clean.slice(0, idx) + ' ' + clean.slice(idx + kw.length)).split(/[^a-z0-9'.#&]+/).filter(Boolean);
    if (rest.every(t => QUALIFIERS.has(t) || /^\d+$/.test(t) || /^\(.*\)$/.test(t))) {
      return { type: mapping.type, mode: mapping.mode || 'value' };
    }
    return null; // longest keyword found but label has other words -> not a PII label
  }
  return null;
}

export function isFieldKeyword(value) {
  const clean = cleanLabel(value);
  return KEYWORD_INDEX.some(k => k.kw === clean);
}

export function isPlaceholder(value) {
  return PLACEHOLDERS.test(String(value || '').trim());
}

// ---------------------------------------------------------------------------
// Value shapes: how far a value extends after "Label:" in running text
// ---------------------------------------------------------------------------
const SHAPE_BY_TYPE = {
  NAME: 'person', DOB: 'date', ADDRESS: 'address', EMAIL: 'token', UPI: 'token', USERNAME: 'token',
  PASSWORD: 'token', API_KEY: 'token', MEDICAL_CONDITION: 'free', SENSITIVE_ATTRIBUTE: 'free',
  LOCATION: 'free', INSURANCE_PROVIDER: 'free', BIOMETRIC: 'free', BLOOD_GROUP: 'blood',
};
const shapeOf = (type) => SHAPE_BY_TYPE[type] || 'id';

const ID_TOKEN = String.raw`[+(]?[A-Za-z0-9/.\-]*\d[A-Za-z0-9/.)\-]*`;
const SHAPES = {
  id: new RegExp(String.raw`^${ID_TOKEN}(?:[ \-]${ID_TOKEN})*`),
  token: /^\S+/,
  blood: /^(?:AB|A|B|O)\s?(?:[+-](?:ve)?|positive|negative)/i,
  date: /^(?:\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/,
  address: /^[^\n;|]{3,150}?(?=\.\s|\.$|[\n;|]|$)/,
  free: /^[^\n;|]{1,80}?(?=\.\s|\.$|[\n;|]|$)/,
};

function personShape(text) {
  const m = /^(?:(?:mr|mrs|ms|dr|shri|sri|smt|kumari)\.?\s+)?(?:[A-Za-z]\.\s?)*[A-Za-z][A-Za-z'’\-]+/i.exec(text);
  if (!m) return 0;
  let end = m[0].length;
  const capitalized = /[A-Z]/.test(text[m[0].search(/[A-Za-z]/)]);
  const next = /^\s(?:[A-Za-z]\.\s?)*([A-Za-z][A-Za-z'’\-]+)/;
  for (let i = 0; i < 4; i++) {
    const n = next.exec(text.slice(end));
    if (!n) break;
    const word = n[1];
    if (capitalized ? !/^[A-Z]/.test(word) : /^(?:and|or|is|was|to|from|at|in|on|the|of|for|with)$/i.test(word)) break;
    end += n[0].length;
  }
  return end;
}

/** Length of the value that starts at text[0] for a given PII type (0 = none). */
export function valueLength(type, text) {
  const shape = shapeOf(type);
  let len;
  if (shape === 'person') len = personShape(text);
  else {
    const m = SHAPES[shape].exec(text);
    len = m ? m[0].length : 0;
  }
  let v = text.slice(0, len);
  // Trim trailing punctuation (keep a closing paren only if it is balanced)
  while (v && /[.,;:\-]$/.test(v) || (v.endsWith(')') && !v.includes('('))) v = v.slice(0, -1);
  v = v.replace(/\s+$/, '');
  if (shape === 'date' && !isDate(v)) return 0;
  return v.length;
}

// Where a label may start: line/segment start, after separators, or after a sentence end
const LABEL_BOUNDARY = /(?:^|[\n\r\t;|•(\[{]|[.!?]\s|,\s|\s-\s)\s*$/;

/**
 * Find "Label: value" / "label=value" pairs in running text.
 * Returns candidate spans on the value with source 'label'.
 */
export function detectLabeledValues(text) {
  const spans = [];
  const sep = /[:：=]/g;
  let m;
  while ((m = sep.exec(text))) {
    const pos = m.index;
    if (/\d/.test(text[pos - 1] || '') && /\d/.test(text[pos + 1] || '')) continue; // 10:30, a=1
    if (text.startsWith('//', pos + 1)) continue; // URLs
    const before = text.slice(Math.max(0, pos - 60), pos).replace(/\s+$/, '');
    if (!before || /(?:https?|mailto|ftp|tel)$/i.test(before)) continue;

    // Try label suffixes of 1..6 words that start at a boundary; keep the longest that resolves
    const words = before.split(/(?<=\s)/);
    let found = null;
    let foundLabel = '';
    for (let n = 1; n <= Math.min(6, words.length); n++) {
      const label = words.slice(-n).join('');
      const head = before.slice(0, before.length - label.length);
      if (head.length > 0 && !LABEL_BOUNDARY.test(head)) continue;
      const res = resolveLabel(label);
      if (res) { found = res; foundLabel = label.trim(); }
    }
    if (!found || found.mode === 'hint') continue;

    const valueStart = pos + 1 + (/^\s*/.exec(text.slice(pos + 1))[0].length);
    const len = valueLength(found.type, text.slice(valueStart));
    if (!len) continue;
    const value = text.slice(valueStart, valueStart + len);
    if (isPlaceholder(value) || isFieldKeyword(value)) continue;
    spans.push({ start: valueStart, end: valueStart + len, type: found.type, score: 0.9, source: 'label',
      reasons: [`value after label '${foundLabel}'`] });
  }
  return spans;
}
