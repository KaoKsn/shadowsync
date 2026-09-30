/**
 * PIIRedactor - Advanced General-Purpose PII & PHI Redaction Engine
 * 3-Pass Pipeline:
 *   Pass 1 (DOM/HTML): Structured field pairing through DOM traversal
 *   Pass 2: Syntactic regex pattern matching (SSN, email, CC, phone, IP, API keys, etc.)
 *   Pass 3: NER via Compromise.js (person names, organization names, contextual entities)
 *
 * Designed for high Recall (zero leaks) while preserving non-sensitive boilerplate.
 */
(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    global.PIIRedactor = factory();
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function isValidLuhn(str) {
    const clean = str.replace(/\D/g, '');
    if (clean.length < 13 || clean.length > 19) return false;
    let sum = 0, shouldDouble = false;
    for (let i = clean.length - 1; i >= 0; i--) {
      let d = parseInt(clean.charAt(i), 10);
      if (shouldDouble) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
      shouldDouble = !shouldDouble;
    }
    return (sum % 10) === 0;
  }

  function formatTag(type, style, originalVal = '') {
    if (style === 'blackout') return '█'.repeat(Math.max((originalVal || '').length, 6));
    if (style === 'mask') {
      const len = (originalVal || '').length;
      if (len > 4) return '•••• '.repeat(Math.floor((len - 4) / 4)) + originalVal.slice(-4);
      return '••••';
    }
    return `[REDACTED_${type}]`;
  }

  /** Escape special regex metacharacters in a string literal */
  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Protect already-redacted tokens and return [scrubbed text, restorer fn] */
  function protectTokens(text) {
    const store = [];
    const scrubbed = text.replace(/\[REDACTED_[A-Z_]+\]|█{6,}/g, (m) => {
      const idx = store.length;
      store.push(m);
      return `\x00P${idx}\x00`;
    });
    const restore = (s) => s.replace(/\x00P(\d+)\x00/g, (_, i) => store[parseInt(i)] || '');
    return [scrubbed, restore];
  }

  // ---------------------------------------------------------------------------
  // Field Mappings for structured label-value redaction
  // ---------------------------------------------------------------------------
  const FIELD_MAPPINGS = [
    { keywords: ['full name', 'first name', 'last name', 'mother\'s maiden name', 'maiden name', 'account owner', 'customer name', 'patient name', 'cardholder name', 'name'], tag: 'NAME' },
    { keywords: ['date of birth', 'dob', 'birthdate', 'birth date'], tag: 'DOB' },
    { keywords: ['place of birth', 'city', 'district', 'state', 'locality', 'region'], tag: 'LOCATION' },
    { keywords: ['nationality', 'gender', 'age', 'marital status'], tag: 'SENSITIVE_ATTRIBUTE' },
    { keywords: ['blood group', 'blood type'], tag: 'MEDICAL_ATTRIBUTE' },
    { keywords: ['house number', 'house no'], tag: 'ADDRESS' },
    { keywords: ['voter id', 'voter identification number'], tag: 'VOTER_ID' },
    { keywords: ['social security number', 'social security', 'ssn', 'sin', 'national insurance number', 'national id', 'government id'], tag: 'SSN' },
    { keywords: ['driving licence', 'driving license', 'driver\'s licence', 'driver\'s license', 'driver licence', 'driver license', 'drivers license', 'license number', 'dl number'], tag: 'DRIVER_LICENSE' },
    { keywords: ['university registration number', 'university registration no', 'university registration', 'roll number', 'roll no', 'usn'], tag: 'STUDENT_ID' },
    { keywords: ['pan reference', 'pan number', 'permanent account number'], tag: 'TAX_ID' },
    { keywords: ['ifsc code', 'ifsc'], tag: 'IFSC_CODE' },
    { keywords: ['passport number', 'passport'], tag: 'PASSPORT' },
    { keywords: ['primary email', 'secondary email', 'contact email', 'email address', 'email'], tag: 'EMAIL' },
    { keywords: ['mobile phone', 'home phone', 'work phone', 'direct line', 'telephone', 'phone number', 'phone', 'cell phone', 'fax'], tag: 'PHONE' },
    { keywords: ['home address', 'physical address', 'shipping address', 'billing address', 'residential address', 'street address', 'mailing address', 'address'], tag: 'ADDRESS' },
    { keywords: ['credit card number', 'card number', 'credit card', 'debit card'], tag: 'CREDIT_CARD' },
    { keywords: ['card expiry / cvv', 'card expiry', 'expiry date', 'expiration date', 'cvv', 'cvc', 'security code', 'card security code'], tag: 'PAYMENT_SECURITY' },
    { keywords: ['bank account number', 'bank account', 'account number', 'checking account', 'savings account'], tag: 'BANK_ACCOUNT' },
    { keywords: ['routing transit number', 'routing number', 'aba routing', 'routing'], tag: 'ROUTING_NUMBER' },
    { keywords: ['medical record #', 'medical record number', 'medical record', 'mrn', 'patient id', 'patient number'], tag: 'MRN' },
    { keywords: ['health insurance provider', 'insurance provider', 'insurer', 'insurance company'], tag: 'INSURANCE_PROVIDER' },
    { keywords: ['policy id / group #', 'policy id', 'policy number', 'group #', 'group number', 'member id', 'insurance id'], tag: 'POLICY_GROUP' },
    { keywords: ['known allergies', 'allergies', 'allergy', 'drug allergies'], tag: 'ALLERGIES' },
    { keywords: ['prescription medications', 'medications', 'prescriptions', 'current medications', 'drugs'], tag: 'PRESCRIPTION_MEDICATIONS' },
    { keywords: ['username', 'user name', 'login name', 'login id', 'user id'], tag: 'USERNAME' },
    { keywords: ['upi id'], tag: 'UPI_ID' },
    { keywords: ['password hash', 'password', 'secret question answer', 'security question answer', 'secret answer'], tag: 'PASSWORD_HASH' },
    { keywords: ['account recovery pin', 'recovery pin', 'security pin', 'account pin', 'pin number', 'pin'], tag: 'PIN' },
    { keywords: ['live api auth key', 'api auth key', 'api key', 'api secret', 'auth key', 'access key', 'secret key'], tag: 'API_KEY' },
    { keywords: ['ip address (last login)', 'ip address', 'last login ip', 'login ip'], tag: 'IP_ADDRESS' },
    { keywords: ['tax id', 'tin', 'tax identification number', 'employer id', 'ein'], tag: 'TAX_ID' },
    { keywords: ['ethnicity', 'race', 'religion', 'sexual orientation', 'gender identity'], tag: 'SENSITIVE_ATTRIBUTE' },
    { keywords: ['biometric', 'fingerprint', 'face scan', 'iris scan', 'retina scan'], tag: 'BIOMETRIC' },
  ];

  function resolveFieldMapping(label) {
    const cleanLabel = String(label || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[:#\s]+$/, '');
    const exactMatch = FIELD_MAPPINGS.find(fm => fm.keywords.some(kw => cleanLabel === kw));
    return exactMatch || FIELD_MAPPINGS.find(fm => fm.keywords.some(kw => cleanLabel.includes(kw))) ||
      (/\bpan\b/i.test(cleanLabel) ? { tag: 'TAX_ID' } : /\bid$/i.test(cleanLabel) ? { tag: 'IDENTIFIER' } : null);
  }

  function isFieldKeyword(value) {
    const cleanValue = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[:#\s]+$/, '');
    return FIELD_MAPPINGS.some(fm => fm.keywords.some(kw => cleanValue === kw));
  }

  // ---------------------------------------------------------------------------
  // PIIRedactor Class
  // ---------------------------------------------------------------------------
  class PIIRedactor {
    constructor(options = {}) {
      this.options = Object.assign({
        style: 'token',       // 'token' | 'blackout' | 'mask'
        luhnCheck: true,      // validate credit cards with Luhn before redacting
        nerNames: true,       // NER Pass 3: detect person names (Compromise.js)
        nerOrgs: true,        // NER Pass 3: detect organization names
        nerPlaces: false,     // NER Pass 3: detect place/location names (higher FP risk)
      }, options);
    }

    // -------------------------------------------------------------------------
    // Internal: Get Compromise.js NLP engine (browser only)
    // -------------------------------------------------------------------------
    _getNLP() {
      if (typeof window !== 'undefined' && typeof window.nlp === 'function') return window.nlp;
      if (typeof global !== 'undefined' && typeof global.nlp === 'function') return global.nlp;
      return null;
    }

    // -------------------------------------------------------------------------
    // Internal: NER-based redaction on a plain text string using Compromise.js
    // -------------------------------------------------------------------------
    _nerRedactText(text, opts) {
      const nlp = this._getNLP();
      if (!nlp || !text || text.trim().length < 3) return text;

      const [scrubbed, restore] = protectTokens(text);

      try {
        const doc = nlp(scrubbed);
        let out = scrubbed;

        // ---- PERSONS ----
        if (opts.nerNames !== false) {
          doc.people().forEach(match => {
            const val = match.text();
            // Filter: must be > 2 chars, must not be a placeholder, must not be HTML
            if (val && val.length > 2 && !val.includes('\x00') && !val.includes('<')) {
              const re = new RegExp(escapeRegex(val), 'g');
              out = out.replace(re, formatTag('NAME', opts.style, val));
            }
          });
        }

        // ---- ORGANIZATIONS (medical providers, companies, institutions) ----
        if (opts.nerOrgs !== false) {
          doc.organizations().forEach(match => {
            const val = match.text();
            if (val && val.length > 3 && !val.includes('\x00') && !val.includes('<')) {
              const re = new RegExp(escapeRegex(val), 'g');
              out = out.replace(re, formatTag('ORGANIZATION', opts.style, val));
            }
          });
        }

        // ---- PLACES ----
        if (opts.nerPlaces) {
          doc.places().forEach(match => {
            const val = match.text();
            if (val && val.length > 3 && !val.includes('\x00') && !val.includes('<')) {
              const re = new RegExp(escapeRegex(val), 'g');
              out = out.replace(re, formatTag('LOCATION', opts.style, val));
            }
          });
        }

        return restore(out);
      } catch (e) {
        // Fail gracefully — return text without NER if Compromise.js errors
        return restore(scrubbed);
      }
    }

    // -------------------------------------------------------------------------
    // Internal: NER pass for HTML — operates only on text nodes (between tags)
    // -------------------------------------------------------------------------
    _nerRedactHTMLNodes(html, opts) {
      const nlp = this._getNLP();
      if (!nlp) return html;

      // Match text content between > and < (HTML text nodes)
      // Only process nodes with at least 4 non-whitespace characters
      return html.replace(/(?<=>)([^<]+)(?=<)/g, (textNode) => {
        const trimmed = textNode.trim();
        if (!trimmed || trimmed.length < 4) return textNode;
        // Skip nodes that are already fully redacted
        if (/^\[REDACTED_[A-Z_]+\]$/.test(trimmed)) return textNode;
        return this._nerRedactText(textNode, opts);
      });
    }

    // -------------------------------------------------------------------------
    // PASS 2: Syntactic regex pattern matching on plain text / HTML text nodes
    // -------------------------------------------------------------------------
    redactText(text, customOptions = {}) {
      if (!text || typeof text !== 'string') return '';
      const opts = Object.assign({}, this.options, customOptions);
      if (!opts._skipHtml && /<\/?[a-z][\w:-]*(?:\s[^<>]*)?>/i.test(text)) {
        return this.redactHTML(text, Object.assign({}, opts, { _skipHtml: true }));
      }

      const [scrubbed, restore] = protectTokens(text);
      let out = scrubbed;

      // 1. Emails
      out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi,
        (m) => formatTag('EMAIL', opts.style, m));

      // 2. SSN — 3-2-4 digit format (excluding definitively invalid 000 & 666 prefixes)
      out = out.replace(/\b(?!000)(?!666)\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}\b/g,
        (m) => formatTag('SSN', opts.style, m));
      // Partial SSN in prose: "SSN ending in 3211"
      out = out.replace(/(\b(?:ssn|social\s*security(?:\s*number)?)\s*(?:ending\s*in|number|#|:)?\s*)(?:<strong>)?([0-9]{4})\b(?:<\/strong>)?/gi,
        (m, prefix, val) => `${prefix}${formatTag('SSN', opts.style, val)}`);

      // 3. Credit Cards (Luhn-validated)
      const ccPat = /\b(?:4[0-9]{3}(?:[- ]?[0-9]{4}){3}|5[1-5][0-9]{2}(?:[- ]?[0-9]{4}){3}|3[47][0-9]{2}[- ]?[0-9]{6}[- ]?[0-9]{5}|6(?:011|5[0-9]{2})(?:[- ]?[0-9]{4}){3})\b/g;
      out = out.replace(ccPat, (m) => (!opts.luhnCheck || isValidLuhn(m)) ? formatTag('CREDIT_CARD', opts.style, m) : m);
      // Partial CC in prose
      out = out.replace(/(\b(?:card|mastercard|visa|amex|american\s*express|discover|credit\s*card|debit\s*card)\s*(?:ending\s*in|number|#|:)?\s*)(?:<strong>)?([0-9]{4})\b(?:<\/strong>)?/gi,
        (m, prefix, val) => `${prefix}${formatTag('CREDIT_CARD', opts.style, val)}`);

      // CVV / CVC
      out = out.replace(/(\b(?:cvv|cvc|security\s*code)\s*[:=]?\s*)(?:<strong>)?([0-9]{3,4})\b(?:<\/strong>)?/gi,
        (m, prefix, val) => `${prefix}${formatTag('CVV', opts.style, val)}`);

      // Card Expiry (contextual: after keyword)
      out = out.replace(/(\b(?:expiry|expiration|exp)\s*(?:date)?\s*[:=]?\s*)(?:<strong>)?((0[1-9]|1[0-2])\/[0-9]{2,4})\b(?:<\/strong>)?/gi,
        (m, prefix, val) => `${prefix}${formatTag('EXPIRY', opts.style, val)}`);

      // 4. Phone numbers — US formatted
      out = out.replace(/(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]([0-9]{3})[-. ]([0-9]{4})\b/g,
        (m) => formatTag('PHONE', opts.style, m));
      // International: +44 7911 123456
      out = out.replace(/\+(?!1\b)[1-9][0-9]{0,2}[-. ]?[0-9]{1,5}[-. ]?[0-9]{3,5}[-. ]?[0-9]{3,5}\b/g, (m) => {
        const d = m.replace(/\D/g, '');
        return (d.length >= 8 && d.length <= 15) ? formatTag('PHONE', opts.style, m) : m;
      });
      // Contextual phone in prose
      out = out.replace(/(\b(?:phone|mobile|telephone|call|hotline|cell)\s*(?:via|at|number|#)?\s*[:=]?\s*)([+]?[0-9\-\s().]{7,20})\b/gi, (m, prefix, num) => {
        const clean = num.replace(/\D/g, '');
        return (clean.length >= 7 && clean.length <= 15) ? `${prefix}${formatTag('PHONE', opts.style, num)}` : m;
      });

      // 5. IP Addresses
      out = out.replace(/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
        (m) => formatTag('IP_ADDRESS', opts.style, m));
      out = out.replace(/\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
        (m) => formatTag('IP_ADDRESS', opts.style, m));

      // 6. API Keys & Secrets
      out = out.replace(/\b(?:sk|pk|rk)_(?:live|test|secret)_[A-Za-z0-9_]{16,}\b/g,
        (m) => formatTag('API_KEY', opts.style, m));
      out = out.replace(/\b(?:api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key|client[_-]?secret|auth[_-]?token|private[_-]?key)\s*[:=]\s*["']?([A-Za-z0-9_\-]{16,})["']?/gi,
        (m, val) => m.replace(val, formatTag('API_KEY', opts.style, val)));
      out = out.replace(/\b(?:AKIA|ASIA|AROA)[0-9A-Z]{16}\b/g, (m) => formatTag('AWS_KEY', opts.style, m));
      out = out.replace(/\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*\b/g,
        (m) => formatTag('JWT_TOKEN', opts.style, m));
      out = out.replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi, (m) => formatTag('AUTH_TOKEN', opts.style, m));

      // 7. Password Hashes
      out = out.replace(/\$2[abxy]\$[0-9]{2}\$[A-Za-z0-9./]{15,}/g, (m) => formatTag('PASSWORD_HASH', opts.style, m));
      out = out.replace(/\$argon2[id]+\$[A-Za-z0-9$=+,./]{20,}/g, (m) => formatTag('PASSWORD_HASH', opts.style, m));

      // 8. Account PIN
      out = out.replace(/(\b(?:recovery\s*pin|security\s*pin|account\s*pin|pin\s*number|pin)\s*[:#=]\s*)(?:<strong>)?([0-9]{4,8})\b(?:<\/strong>)?/gi,
        (m, prefix, val) => `${prefix}${formatTag('PIN', opts.style, val)}`);

      // 9. Dates of Birth (contextual — keyword must precede)
      out = out.replace(/(\b(?:dob|date\s*of\s*birth|birth\s*date|birthdate|born)\s*(?:is|on|:)?\s*\(?)(?:<strong>)?([0-9]{1,2}[\/\.-][0-9]{1,2}[\/\.-][0-9]{2,4}|[0-9]{4}[\/\.-][0-9]{1,2}[\/\.-][0-9]{1,2}|[A-Za-z]+\s+[0-9]{1,2},?\s+[0-9]{4}|[0-9]{1,2}\s+[A-Za-z]+,?\s+[0-9]{4})(?:<\/strong>)?(\)?)/gi,
        (m, p1, dateVal, p2) => `${p1}${formatTag('DOB', opts.style, dateVal)}${p2}`);
      // Verified identity using DOB
      out = out.replace(/(\b(?:verified?\s*(?:identity\s*)?(?:using|with|via)\s*(?:her|his|their)?\s*(?:dob|date\s*of\s*birth)?)\s*\(?)(?:<strong>)?([0-9]{1,2}[\/\.-][0-9]{1,2}[\/\.-][0-9]{2,4})(?:<\/strong>)?(\)?)/gi,
        (m, p1, dateVal, p2) => `${p1}${formatTag('DOB', opts.style, dateVal)}${p2}`);

      // 10. Bank Routing Numbers (contextual)
      out = out.replace(/(\b(?:Routing|ABA\s*Routing|Routing\s*Number|RTN)\s*[:#=]?\s*)(?:<strong>)?([0-9]{9})\b(?:<\/strong>)?/gi,
        (m, prefix, val) => `${prefix}${formatTag('ROUTING_NUMBER', opts.style, val)}`);

      // Indian PAN and IFSC identifiers (contextual)
      out = out.replace(/(\bPAN(?:\s+(?:reference|number|no\.?))?\s*[:#=]?\s*)([A-Z]{5}[0-9]{4}[A-Z])\b/gi,
        (m, prefix, val) => `${prefix}${formatTag('TAX_ID', opts.style, val)}`);
      out = out.replace(/(\bIFSC(?:\s+code)?\s*[:#=]?\s*)([A-Z]{4}0[A-Z0-9]{6})\b/gi,
        (m, prefix, val) => `${prefix}${formatTag('IFSC_CODE', opts.style, val)}`);

      // 11. Medical Record Numbers
      out = out.replace(/\bMRN?[-\s]?[0-9A-Z]{4,12}\b/gi, (m) => formatTag('MRN', opts.style, m));

      // 12. Passport Numbers: 1-2 alpha + 7-9 digits
      out = out.replace(/\b[A-Z]{1,2}[0-9]{7,9}\b/g, (m) => formatTag('PASSPORT', opts.style, m));

      // 13. Driver's License
      out = out.replace(/\bDL[N-]?[A-Z0-9\-]{6,18}\b/gi, (m) => formatTag('DRIVER_LICENSE', opts.style, m));

      // 14. Customer Account numbers
      out = out.replace(/(\b(?:customer\s*account|account)\s*#)([A-Z0-9\-]{6,16})\b/gi,
        (m, prefix, val) => `${prefix}${formatTag('ACCOUNT', opts.style, val)}`);

      // 15. Policy numbers
      out = out.replace(/\bPOL[-\s][A-Z0-9\-]{4,14}\b/gi, (m) => formatTag('POLICY', opts.style, m));

      // 16. Authorized contact / relative names in prose
      out = out.replace(/(\b(?:husband|wife|spouse|partner|son|daughter|mother|father|parent|sibling|brother|sister|representative|contact|agent|attorney|guardian|authorized\s*user|co-?signer)\s*,\s*)(?:<strong>)?([A-Z][a-zA-Z'.\-]+(?:\s+[A-Z][a-zA-Z'.\-]+)+)(?:<\/strong>)?(\s*,)/gi,
        (m, prefix, name, suffix) => `${prefix}${formatTag('NAME', opts.style, name)}${suffix}`);

      // 17. Name before Routing/Account in prose tables
      out = out.replace(/([A-Z][a-zA-Z'.\-]+(?:\s+[A-Z][a-zA-Z'.\-]+)+)(\s*\((?:Routing|RTN|ABA|Account|Acct))/gi,
        (m, name, suffix) => `${formatTag('NAME', opts.style, name)}${suffix}`);

      // 18. Medical facility names
      out = out.replace(/(\b(?:treatment\s*(?:at|in)|admitted\s*to|hospitalized\s*at|seen\s*at)\s*)(?:<strong>)?([A-Z][a-zA-Z'.\-]+(?:\s+[A-Z][a-zA-Z'.\-]+)*\s+(?:Hospital|Clinic|Medical\s*Center|Health\s*Center|Infirmary|Care\s*Center|Institute))(?:<\/strong>)?/gi,
        (m, prefix, fac) => `${prefix}${formatTag('MEDICAL_FACILITY', opts.style, fac)}`);

      // 19. Medical conditions in prose
      out = out.replace(/(\b(?:treatment\s*(?:at\s*[^.]+)?\s*for|diagnosed\s*with|suffering\s*from|admitted\s*for|treatment\s*of|prescribed\s*for)\s*)([a-zA-Z\s]{4,40}?)(?=[.,;\n]|\band\b)/gi,
        (m, prefix, condition) => `${prefix}${formatTag('MEDICAL_CONDITION', opts.style, condition.trim())}`);

      out = restore(out);

      // -----------------------------------------------------------------------
      // PASS 3: NER — names, organizations (Compromise.js, browser only)
      // Skipped when called internally from redactHTML (which does its own
      // text-node NER pass via _nerRedactHTMLNodes to avoid double-processing)
      // -----------------------------------------------------------------------
      if (!opts._skipNer) {
        out = this._nerRedactText(out, opts);
      }

      return out;
    }

    // -------------------------------------------------------------------------
    // Redact a cloned DOM tree without changing the caller's source tree.
    redactDOM(domRoot, customOptions = {}) {
      if (!domRoot || typeof domRoot.cloneNode !== 'function') return null;
      const opts = Object.assign({}, this.options, customOptions);
      const root = domRoot.cloneNode(true);
      const doc = root.nodeType === 9 ? root : root.ownerDocument;
      const queryRoot = root.nodeType === 9 ? root.documentElement : root;
      if (!doc || !queryRoot || typeof queryRoot.querySelectorAll !== 'function') return root;

      const elements = (selector) => {
        const matches = [];
        if (queryRoot.matches && queryRoot.matches(selector)) matches.push(queryRoot);
        matches.push(...queryRoot.querySelectorAll(selector));
        return matches;
      };

      const headerSelector = 'header, thead, tfoot, caption, h1, h2, h3, h4, h5, h6, [role="heading"], [role="columnheader"]';
      const isHeaderContent = (element) => Boolean(element.closest && element.closest(headerSelector));
      const redactValue = (valueElement, mapping) => {
        if (!valueElement || !mapping) return;
        if (isHeaderContent(valueElement) || valueElement.closest('th')) return;
        const cleanValue = valueElement.textContent.trim();
        if (!cleanValue || cleanValue.includes('[REDACTED_') || cleanValue.includes('███')) return;
        if (isFieldKeyword(cleanValue)) return;
        if (mapping.tag === 'ADDRESS' && cleanValue.toLowerCase().includes('same as')) return;
        valueElement.textContent = formatTag(mapping.tag, opts.style, cleanValue);
      };

      const boundarySelector = 'tr, .data-row, .field, .form-group, li, p';
      const classFields = elements('.label, .value');
      let pendingLabel = null;
      let pendingMapping = null;
      for (const element of classFields) {
        if (element.matches('.label')) {
          if (isHeaderContent(element)) {
            pendingLabel = null;
            pendingMapping = null;
            continue;
          }
          pendingLabel = element;
          pendingMapping = resolveFieldMapping(element.textContent);
          continue;
        }
        if (!pendingLabel || !pendingMapping) continue;
        if (isHeaderContent(element)) continue;
        const labelBoundary = pendingLabel.closest(boundarySelector);
        const valueBoundary = element.closest(boundarySelector);
        if ((labelBoundary && labelBoundary === valueBoundary) || (!labelBoundary && !valueBoundary)) {
          redactValue(element, pendingMapping);
        }
        pendingLabel = null;
        pendingMapping = null;
      }

      for (const row of elements('tr')) {
        const cells = Array.from(row.children).filter(cell => cell.matches('th, td'));
        for (let index = 0; index < cells.length - 1; index++) {
          const labelCell = cells[index];
          if (labelCell.classList.contains('value')) continue;
          const mapping = resolveFieldMapping(labelCell.textContent);
          if (!mapping) continue;
          const valueCell = cells.slice(index + 1).find(cell => cell.classList.contains('value')) || cells[index + 1];
          redactValue(valueCell, mapping);
        }
      }

      for (const labelElement of elements('label, dt')) {
        if (isHeaderContent(labelElement)) continue;
        const mapping = resolveFieldMapping(labelElement.textContent);
        if (!mapping) continue;
        const valueElement = labelElement.nextElementSibling;
        if (valueElement && !valueElement.matches('label, dt')) redactValue(valueElement, mapping);
      }

      const walker = doc.createTreeWalker(root, 4);
      let textNode;
      while ((textNode = walker.nextNode())) {
        if (textNode.parentElement && (textNode.parentElement.closest(`script, style, noscript, th, ${headerSelector}`))) continue;
        textNode.nodeValue = this.redactText(textNode.nodeValue, Object.assign({}, opts, { _skipHtml: true }));
      }

      return root;
    }

    // PASS 1 + 2 + 3: Full HTML redaction
    // -------------------------------------------------------------------------
    redactHTML(htmlString, customOptions = {}) {
      if (htmlString && typeof htmlString === 'object' && typeof htmlString.cloneNode === 'function') {
        return this.redactDOM(htmlString, customOptions);
      }
      if (!htmlString || typeof htmlString !== 'string') return '';
      if (typeof DOMParser !== 'undefined') {
        const source = htmlString;
        const parsed = new DOMParser().parseFromString(source, 'text/html');
        const redacted = this.redactDOM(parsed, customOptions);
        if (/<html(?:\s|>)/i.test(source)) {
          const doctype = redacted.doctype ? `<!DOCTYPE ${redacted.doctype.name}>` : '';
          return `${doctype}${redacted.documentElement.outerHTML}`;
        }
        return redacted.body.innerHTML;
      }
      const opts = Object.assign({}, this.options, customOptions);
      let html = htmlString;

      // -----------------------------------------------------------------------
      // PASS 1: Structured label-value pair redaction
      // Match class-marked fields and semantic label/table/list sibling pairs.
      // -----------------------------------------------------------------------
      const redactFieldPair = (fullMatch, prefix, labelHtml, valHtml, suffix) => {
        const cleanLabel = labelHtml.replace(/<[^>]+>/g, '').trim().toLowerCase().replace(/[:#\s]+$/, '');
        const cleanVal = valHtml.replace(/<[^>]+>/g, '').trim();

        if (!cleanVal || cleanVal.includes('[REDACTED_') || cleanVal.includes('███')) return fullMatch;

        const exactMatch = FIELD_MAPPINGS.find(fm => fm.keywords.some(kw => cleanLabel === kw));
        const matched = exactMatch || FIELD_MAPPINGS.find(fm => fm.keywords.some(kw => cleanLabel.includes(kw))) ||
          (/\bpan\b/i.test(cleanLabel) ? { tag: 'TAX_ID' } : /\bid$/i.test(cleanLabel) ? { tag: 'IDENTIFIER' } : null);
        if (!matched) return fullMatch;

        let replacementVal;
        if (matched.tag === 'IP_ADDRESS') {
          replacementVal = cleanVal.replace(/\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g, (m) => formatTag('IP_ADDRESS', opts.style, m));
          if (replacementVal === cleanVal) replacementVal = formatTag('IP_ADDRESS', opts.style, cleanVal);
        } else if (matched.tag === 'PAYMENT_SECURITY') {
          replacementVal = cleanVal.replace(/(0[1-9]|1[0-2])\/[0-9]{2,4}/g, (m) => formatTag('EXPIRY', opts.style, m));
          replacementVal = replacementVal.replace(/(\b(?:cvv|cvc)\s*[:=]?\s*)([0-9]{3,4})/gi, (m, p, v) => `${p}${formatTag('CVV', opts.style, v)}`);
        } else if (matched.tag === 'ADDRESS' && cleanVal.toLowerCase().includes('same as')) {
          replacementVal = cleanVal; // Preserve cross-reference text
        } else {
          replacementVal = formatTag(matched.tag, opts.style, cleanVal);
        }

        return `${prefix}${replacementVal}${suffix}`;
      };

      const classPairRegex = /(<([a-z][\w:-]*)\b[^>]*class=["'][^"']*\blabel\b[^"']*["'][^>]*>([\s\S]*?)<\/\2\s*>[\s\S]*?<([a-z][\w:-]*)\b[^>]*class=["'][^"']*\bvalue\b[^"']*["'][^>]*>)([\s\S]*?)(<\/\4\s*>)/gi;
      html = html.replace(classPairRegex, (fullMatch, prefix, labelTag, labelHtml, valueTag, valHtml, suffix) =>
        redactFieldPair(fullMatch, prefix, labelHtml, valHtml, suffix));

      const semanticPairRegex = /(<(label|th|td|dt)\b[^>]*>(?!\s*\d+\s*<\/\2\s*>)([\s\S]*?)<\/\2\s*>\s*<([a-z][\w:-]*)\b[^>]*>)([\s\S]*?)(<\/\4\s*>)/gi;
      html = html.replace(semanticPairRegex, (fullMatch, prefix, labelTag, labelHtml, valueTag, valHtml, suffix) =>
        redactFieldPair(fullMatch, prefix, labelHtml, valHtml, suffix));

      // -----------------------------------------------------------------------
      // PASS 2: Syntactic regex on remaining text content
      // -----------------------------------------------------------------------
      html = this.redactText(html, Object.assign({}, opts, { _skipNer: true, _skipHtml: true }));

      // -----------------------------------------------------------------------
      // PASS 3: NER on HTML text nodes (Compromise.js)
      // -----------------------------------------------------------------------
      html = this._nerRedactHTMLNodes(html, opts);

      return html;
    }
  }

  // Static shorthand APIs
  PIIRedactor.redactText = (text, opts) => new PIIRedactor(opts).redactText(text);
  PIIRedactor.redactHTML = (html, opts) => new PIIRedactor(opts).redactHTML(html);

  return PIIRedactor;
}));
