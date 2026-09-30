/**
 * Local DOM Sanitizer Engine (redactor.js)
 *
 * Features:
 * - Local PII Scrubbing (Emails, Passwords, Credit Cards with Luhn check, SSNs, Phone Numbers, JWTs, Bearer Tokens, API Keys, Usernames, Account Holder Names)
 * - Targeted DOM Nodes & Attributes (Text nodes, input/textarea values, placeholder, aria-label, title, alt, href)
 * - Preserves Mapping Integrity (Keeps data-* attributes, tag types, IDs, and structure intact)
 * - Accepts DOM Document / HTML String / File and outputs sanitized DOM Document / HTML File / String.
 */

(function (global, factory) {
  if (typeof exports === "object" && typeof module !== "undefined") {
    module.exports = factory();
  } else if (typeof define === "function" && define.amd) {
    define(factory);
  } else {
    global.DOMRedactor = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // --- Luhn Algorithm Validator ---
  function isValidLuhn(numberStr) {
    const digits = numberStr.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let shouldDouble = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = parseInt(digits.charAt(i), 10);
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
  }

  // --- Regex Patterns for PII ---
  const PII_PATTERNS = {
    // JSON Web Token (JWT)
    jwt: /\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*\b/g,

    // Bearer Token
    bearer: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,

    // Aadhaar Number
    aadhaar: /\b(?:\d{4}[\s-]?){2}\d{4}\b/g,

    // Known Vendor & Provider API Keys (OpenAI, Anthropic, OpenRouter, HuggingFace, Replicate, AWS, GitHub, Google, Stripe, Slack, SendGrid, Twilio, Resend, Supabase)
    vendorApiKey:
      /\b(?:sk-proj-[a-zA-Z0-9_-]{20,}|sk-ant-[a-zA-Z0-9_-]{20,}|sk-or-v1-[a-zA-Z0-9_-]{20,}|sk-[a-zA-Z0-9_-]{20,}|hf_[a-zA-Z0-9]{32,}|r8_[a-zA-Z0-9]{32,}|(?:AKIA|ASIA|AGPA|AIPA|ANPA|ANVA|AROA)[0-9A-Z]{16}|(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{20,}|AIzaSy[A-Za-z0-9_-]{33}|(?:sk|pk|rk)_(?:live|test)_[0-9a-zA-Z]{24,34}|xox[baprs]-[0-9a-zA-Z-]{10,64}|SG\.[a-zA-Z0-9_-]{10,32}\.[a-zA-Z0-9_-]{20,64}|SK[0-9a-fA-F]{32}|sbp_[a-zA-Z0-9]{40,}|re_[a-zA-Z0-9]{24,}|sq0idp-[0-9A-Za-z-_]{22})\b/g,

    // Contextual API Key & Secret patterns (e.g. API Key: <key>, X-API-KEY: <key>, secret_key: "<key>", apiKey = "<key>")
    contextualApiKey:
      /\b(?:api[\s_-]?key|x[\s_-]?api[\s_-]?key|secret[\s_-]?key|access[\s_-]?token|auth[\s_-]?token|private[\s_-]?key|client[\s_-]?secret|api[\s_-]?secret)\s*[:=]\s*['"]?([a-zA-Z0-9_\-.~+/=]{8,})['"]?/gi,

    // Key-value pairs for secrets in strings/URLs (e.g., api_key=xyz, secret=abc, token=123)
    secretParam:
      /([?&]?(?:api[\s_-]?key|x[\s_-]?api[\s_-]?key|access[\s_-]?token|auth[\s_-]?token|secret|password|pwd|token)=)[^&%\s]+/gi,

    // 32-64 character standalone hex API keys / secrets (e.g., 4a8f9c1e2d3b4a5b6c7d8e9f0a1b2c3d)
    genericHexKey: /\b[a-fA-F0-9]{32,64}\b/g,

    // Email address
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,

    // US Social Security Number (SSN)
    ssn: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,

    // Phone Numbers (US & International formats: +1 (555) 234-5678, +91 9876543210, 555-234-5678)
    phone: /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,

    pan: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi,

    ifsc: /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi,

    vehicleRegistration:
      /\b[A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{1,3}[\s-]?\d{1,4}\b/gi,

    indianPassport: /\b[A-Z][0-9]{7}\b/gi,
    // Account Holder, Cardholder, and Person Name contextual patterns (handles single & multiline names)
    nameContext:
      /\b(?:Account\s+(?:holder|owner|name)|Registered\s+(?:holder|owner|name)|Cardholder(?:\s+name)?|Card\s+holder|User\s*name|Username|Logged\s+in\s+as|Full\s+name|First\s+name|Last\s+name|Customer\s+name|Member\s+name|Billing\s+name|Shipping\s+name|Contact\s+name|Owner\s+name|Holder\s+name|Account\s+User|User\s+Profile|Holder)\s*[:=]\s*([A-Za-z0-9.\s'-]{2,50}?)(?=\s*(?:Registered\s|Email|Phone|SSN|Address|Card|Status|ID|<|$))/gi,
  };

  /**
   * Compiles extra PII strings (found by the offscreen NER/PII engine) into one
   * whole-word, case-sensitive regex (so a name like "Will" leaves the verb "will" alone).
   * Longest first so "Priya Sharma" beats "Priya".
   * @param {string[]} terms
   * @returns {RegExp|null}
   */
  function compileTerms(terms) {
    const list = Array.from(new Set((terms || []).map((t) => String(t || "").trim())))
      .filter((t) => t.length >= 3)
      .sort((a, b) => b.length - a.length)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
    if (!list.length) return null;
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.join("|")})(?![\\p{L}\\p{N}])`, "gu");
  }

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const WORD_BOUNDED = (body, flags) =>
    new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, flags);

  /**
   * Compiles the user's own key → value profile into matchers that find those
   * exact values anywhere in page text. Works for any keys; nothing here knows
   * which fields exist. Values are matched case-insensitively with flexible
   * whitespace; number-like values (phones, IDs) also match with any
   * separators, and a value with a country code also matches its last 10 digits.
   *
   * @param {Object<string,string>} profile
   * @param {{skipKeys?: string[], nameKeys?: string[]}} [options]
   *   skipKeys: keys never redacted (generic values); nameKeys: keys whose
   *   individual words (≥3 letters, as capitalised in the profile) are also masked.
   * @returns {{value: RegExp|null, valueKeys: string[], word: RegExp|null, wordKeys: string[]}|null}
   */
  function compileProfile(profile, options = {}) {
    if (!profile || typeof profile !== "object") return null;
    const skip = new Set(options.skipKeys || []);
    const nameKeys = new Set(options.nameKeys || []);
    const values = []; // { key, pattern, len }
    const words = [];
    const seen = new Set();

    const add = (list, key, pattern, len) => {
      if (seen.has(pattern)) return;
      seen.add(pattern);
      list.push({ key, pattern, len });
    };

    for (const [key, raw] of Object.entries(profile)) {
      if (skip.has(key) || typeof raw !== "string") continue;
      const value = raw.trim();
      if (value.length < 3) continue;

      const digits = value.replace(/\D/g, "");
      if (/^[+\d\s().\-/]+$/.test(value)) {
        // Number-like: match the digit sequence with any separators between digits
        if (digits.length < 4) continue;
        const flex = (d) => d.split("").join("[\\s.()\\-/]*");
        add(values, key, flex(digits), digits.length);
        if (digits.length > 10) add(values, key, flex(digits.slice(-10)), 10);
        continue;
      }

      add(values, key, escapeRegex(value).replace(/\s+/g, "\\s+"), value.length);

      if (nameKeys.has(key)) {
        value.split(/\s+/)
          .filter((w) => w.length >= 3 && /^\p{Lu}/u.test(w))
          .forEach((w) => add(words, key, escapeRegex(w), w.length));
      }
    }

    // Longest first so "John Doe" is replaced whole before "John"
    const build = (list, flags) => {
      if (!list.length) return { re: null, keys: [] };
      list.sort((a, b) => b.len - a.len);
      return {
        re: WORD_BOUNDED(list.map((v) => `(${v.pattern})`).join("|"), flags),
        keys: list.map((v) => v.key),
      };
    };
    const v = build(values, "giu");
    const w = build(words, "gu"); // case-sensitive: "Will" the name, not "will" the verb
    if (!v.re && !w.re) return null;
    return { value: v.re, valueKeys: v.keys, word: w.re, wordKeys: w.keys };
  }

  // Typed spans for callers that need to show / replace individual findings
  // (the text-box PII guard) rather than get a redacted string back.
  const FIND_PATTERNS = [
    ["EMAIL", PII_PATTERNS.email],
    ["AADHAAR", PII_PATTERNS.aadhaar],
    ["PAN", PII_PATTERNS.pan],
    ["IFSC", PII_PATTERNS.ifsc],
    ["PASSPORT", PII_PATTERNS.indianPassport],
    ["SSN", PII_PATTERNS.ssn],
    ["JWT", PII_PATTERNS.jwt],
    ["API_KEY", PII_PATTERNS.vendorApiKey],
    ["PHONE", PII_PATTERNS.phone],
  ];

  /**
   * Finds PII in `text` with the local regex rules (no NER).
   * @returns {{type: string, text: string, start: number, end: number}[]} non-overlapping, in order
   */
  function findPII(text) {
    if (!text || typeof text !== "string") return [];
    const found = [];
    const taken = (s, e) => found.some((f) => s < f.end && f.start < e);
    const add = (type, s, e) => { if (!taken(s, e)) found.push({ type, text: text.slice(s, e), start: s, end: e }); };

    // Cards first (Luhn-checked) so their digits aren't read as phones / Aadhaar
    for (const m of text.matchAll(/\b(?:\d[ -]*?){13,19}\b/g)) {
      if (isValidLuhn(m[0])) add("CREDIT_CARD", m.index, m.index + m[0].length);
    }
    for (const [type, re] of FIND_PATTERNS) {
      for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) {
        add(type, m.index, m.index + m[0].length);
      }
    }
    return found.sort((a, b) => a.start - b.start);
  }

  /** Replaces profile matches; records a count per profile key (never the value). */
  function redactProfile(text, stats, profile) {
    const pass = (input, re, keys) => {
      if (!re) return input;
      return input.replace(re, (...args) => {
        const groups = args.slice(1, keys.length + 1);
        const key = keys[groups.findIndex((g) => g !== undefined)];
        if (stats) {
          if (stats.profile !== undefined) stats.profile++;
          if (stats.profileMatches && key) {
            stats.profileMatches[key] = (stats.profileMatches[key] || 0) + 1;
          }
        }
        return "[REDACTED]";
      });
    };
    return pass(pass(text, profile.value, profile.valueKeys), profile.word, profile.wordKeys);
  }

  /**
   * Redacts PII in a given text string.
   * @param {string} text
   * @param {object} stats - Counter object to track redactions by type
   * @param {RegExp|null} [terms] - Extra PII strings from compileTerms()
   * @param {object|null} [profile] - The user's own values, from compileProfile()
   * @returns {string} Redacted text
   */
  function redactString(text, stats, terms, profile) {
    if (!text || typeof text !== "string") return text;

    let result = text;

    function recordRedaction(type, count = 1) {
      if (stats && stats[type] !== undefined) {
        stats[type] += count;
      }
    }

    // The user's own profile values first: exact, known data, matched before
    // the generic patterns below can split a value into partial redactions
    if (profile) {
      result = redactProfile(result, stats, profile);
    }

    // Engine/NER entities next: they were detected on the original, unredacted text
    if (terms) {
      result = result.replace(terms, () => {
        recordRedaction("entity");
        return "[REDACTED]";
      });
    }

    // Indian PAN
    result = result.replace(PII_PATTERNS.pan, (match) => {
      recordRedaction("pan");
      return "[REDACTED]";
    });

    // IFSC
    result = result.replace(PII_PATTERNS.ifsc, (match) => {
      recordRedaction("ifsc");
      return "[REDACTED]";
    });

    // Vehicle registration
    result = result.replace(PII_PATTERNS.vehicleRegistration, (match) => {
      recordRedaction("vehicleRegistration");
      return "[REDACTED]";
    });

    // Indian passport
    result = result.replace(PII_PATTERNS.indianPassport, (match) => {
      recordRedaction("indianPassport");
      return "[REDACTED]";
    });

    // 1. Redact JWTs
    result = result.replace(PII_PATTERNS.jwt, (match) => {
      recordRedaction("jwt");
      return "[REDACTED]";
    });

    // Redact Aadhaar numbers
    result = result.replace(PII_PATTERNS.aadhaar, (match) => {
      recordRedaction("aadhaar");
      return "[REDACTED]";
    });

    // 2. Redact Bearer Tokens
    result = result.replace(PII_PATTERNS.bearer, (match) => {
      recordRedaction("bearer");
      return "[REDACTED]";
    });

    // 3. Redact Vendor API Keys
    result = result.replace(PII_PATTERNS.vendorApiKey, (match) => {
      recordRedaction("apiKey");
      return "[REDACTED]";
    });

    // 4. Redact Contextual API Keys (e.g. API Key: 12345..., secret_key: "abc...")
    result = result.replace(PII_PATTERNS.contextualApiKey, (match, keyVal) => {
      recordRedaction("apiKey");
      return match.replace(keyVal, "[REDACTED]");
    });

    // 5. Redact URL / Parameter Secrets
    result = result.replace(PII_PATTERNS.secretParam, (match, prefix) => {
      recordRedaction("apiKey");
      return prefix + "[REDACTED]";
    });

    // 6. Redact Generic Hex API Keys / Secrets (32-64 hex chars)
    result = result.replace(PII_PATTERNS.genericHexKey, (match) => {
      recordRedaction("apiKey");
      return "[REDACTED]";
    });

    // 7. Redact Emails
    result = result.replace(PII_PATTERNS.email, (match) => {
      recordRedaction("email");
      return "[REDACTED]";
    });

    // 8. Redact SSNs
    result = result.replace(PII_PATTERNS.ssn, (match) => {
      recordRedaction("ssn");
      return "[REDACTED]";
    });

    // 9. Credit Card Numbers (using Luhn Validation BEFORE phone regex)
    // Match sequence of digits with optional spaces or hyphens (13 to 19 digits)
    const creditCardCandidateRegex = /\b(?:\d[ -]*?){13,19}\b/g;
    result = result.replace(creditCardCandidateRegex, (match) => {
      const rawDigits = match.replace(/\D/g, "");
      if (
        rawDigits.length >= 13 &&
        rawDigits.length <= 19 &&
        isValidLuhn(rawDigits)
      ) {
        recordRedaction("creditCard");
        return "[REDACTED]";
      }
      return match;
    });

    // 10. Redact Phone Numbers (processed AFTER credit cards so 16-digit cards aren't split as phones)
    result = result.replace(PII_PATTERNS.phone, (match) => {
      recordRedaction("phone");
      return "[REDACTED]";
    });

    // 11. Redact Account Holder & User Names (Contextual)
    result = result.replace(PII_PATTERNS.nameContext, (match, nameVal) => {
      if (!nameVal || !nameVal.trim()) return match;
      recordRedaction("username");
      return match.replace(nameVal, "[REDACTED]");
    });

    return result;
  }

  /**
   * Sanitizes href attributes specifically.
   * @param {string} href
   * @param {object} stats
   */
  function redactHref(href, stats, terms, profile) {
    if (!href) return href;
    if (href.startsWith("mailto:")) {
      const emailPart = href.substring(7);
      const redactedEmail = redactString(emailPart, stats, terms, profile);
      return "mailto:" + redactedEmail;
    }
    if (href.startsWith("tel:")) {
      if (stats && stats.phone !== undefined) stats.phone++;
      return "tel:[REDACTED]";
    }
    return redactString(href, stats, terms, profile);
  }

  class DOMRedactor {
    /**
     * @param {object} options
     */
    constructor(options = {}) {
      this.options = Object.assign(
        {
          redactTextNodes: true,
          redactInputs: true,
          targetAttributes: [
            "placeholder",
            "aria-label",
            "title",
            "alt",
            "href",
          ],
        },
        options,
      );
    }

    /**
     * Main entry point to sanitize DOM.
     * Accepts HTML string, File, Blob, or DOM Document/Element.
     * @param {string|File|Blob|Document|Element} input
     * @returns {Promise<{doc: Document, html: string, stats: object}>}
     */
    async sanitize(input) {
      let doc;
      const stats = {
        password: 0,
        aadhaar: 0,
        indianPassport: 0,
        ifsc: 0,
        pan: 0,
        vehicleRegistration: 0,
        email: 0,
        phone: 0,
        creditCard: 0,
        username: 0,
        ssn: 0,
        jwt: 0,
        bearer: 0,
        apiKey: 0,
        total: 0,
      };

      if (typeof input === "string") {
        const parser = new DOMParser();
        doc = parser.parseFromString(input, "text/html");
      } else if (input instanceof File || input instanceof Blob) {
        const text = await input.text();
        const parser = new DOMParser();
        doc = parser.parseFromString(text, "text/html");
      } else if (input && input.nodeType === Node.DOCUMENT_NODE) {
        doc = input.cloneNode(true);
      } else if (input && input.nodeType === Node.ELEMENT_NODE) {
        const parser = new DOMParser();
        doc = parser.parseFromString(input.outerHTML, "text/html");
      } else {
        throw new Error("Invalid DOM input provided to DOMRedactor.");
      }

      // Traverse and sanitize DOM tree
      this.traverseAndSanitize(doc.documentElement || doc.body, stats);

      // Compute total redactions
      stats.total = Object.keys(stats)
        .filter((k) => k !== "total")
        .reduce((acc, curr) => acc + stats[curr], 0);

      // Serialize document back to HTML string
      let html = doc.doctype
        ? `<!DOCTYPE ${doc.doctype.name}` +
          (doc.doctype.publicId ? ` PUBLIC "${doc.doctype.publicId}"` : "") +
          (!doc.doctype.publicId && doc.doctype.systemId ? " SYSTEM" : "") +
          (doc.doctype.systemId ? ` "${doc.doctype.systemId}"` : "") +
          `>\n` +
          doc.documentElement.outerHTML
        : doc.documentElement.outerHTML;

      return { doc, html, stats };
    }

    /**
     * Recursively traverses DOM nodes and sanitizes targeted elements and attributes.
     * Preserves data-* attributes, tag types, and node hierarchy completely intact.
     * @param {Node} node
     * @param {object} stats
     */
    traverseAndSanitize(node, stats) {
      if (!node) return;

      // 1. Text Node Handling
      if (node.nodeType === Node.TEXT_NODE) {
        if (this.options.redactTextNodes && node.nodeValue) {
          node.nodeValue = redactString(node.nodeValue, stats);
        }
        return;
      }

      // 2. Element Node Handling
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();

        // Check for Input or Textarea elements
        if (tagName === "input" || tagName === "textarea") {
          const type = (node.getAttribute("type") || "text").toLowerCase();

          // Passwords
          if (type === "password") {
            if (node.hasAttribute("value")) {
              node.setAttribute("value", "[REDACTED]");
              stats.password++;
            }
            node.value = "[REDACTED]";
          } else {
            // Check if field name, id, or placeholder indicates API Key, Token, Password, Username, or Account Holder Name
            const nameAttr = (node.getAttribute("name") || "").toLowerCase();
            const idAttr = (node.getAttribute("id") || "").toLowerCase();
            const placeholderAttr = (
              node.getAttribute("placeholder") || ""
            ).toLowerCase();
            const autocompleteAttr = (
              node.getAttribute("autocomplete") || ""
            ).toLowerCase();

            const isSecretField =
              nameAttr.includes("password") ||
              idAttr.includes("password") ||
              autocompleteAttr.includes("password");
            const isApiKeyField =
              nameAttr.includes("api") ||
              idAttr.includes("api") ||
              nameAttr.includes("key") ||
              idAttr.includes("key") ||
              nameAttr.includes("token") ||
              idAttr.includes("token") ||
              nameAttr.includes("secret") ||
              idAttr.includes("secret");
            const isUsernameField =
              nameAttr.includes("username") ||
              idAttr.includes("username") ||
              nameAttr.includes("user_name") ||
              idAttr.includes("name") ||
              idAttr.includes("holder") ||
              nameAttr.includes("holder") ||
              nameAttr.includes("owner") ||
              idAttr.includes("owner");

            if (isSecretField) {
              if (node.hasAttribute("value")) {
                node.setAttribute("value", "[REDACTED]");
                stats.password++;
              }
              node.value = "[REDACTED]";
            } else if (isApiKeyField) {
              if (node.hasAttribute("value") && node.getAttribute("value")) {
                node.setAttribute("value", "[REDACTED]");
                stats.apiKey++;
              }
              node.value = "[REDACTED]";
            } else if (isUsernameField) {
              if (node.hasAttribute("value") && node.getAttribute("value")) {
                node.setAttribute("value", "[REDACTED]");
                stats.username++;
              }
              node.value = "[REDACTED]";
            } else {
              // CHANGE:
              // Sanitize the LIVE DOM property's current value as well as
              // the HTML `value` attribute.
              //
              // This handles inputs whose value was populated dynamically
              // by JavaScript and therefore has no `value` attribute.

              const currentValue = node.value;

              if (currentValue) {
                const redactedValue = redactString(currentValue, stats);

                // Update the cloned input's actual value property.
                node.value = redactedValue;

                // Also update the cloned HTML attribute if it exists.
                if (node.hasAttribute("value")) {
                  node.setAttribute("value", redactedValue);
                }
              } else if (node.hasAttribute("value")) {
                // Handle a static HTML value attribute.
                const originalVal = node.getAttribute("value");
                const redactedVal = redactString(originalVal, stats);

                node.setAttribute("value", redactedVal);
                node.value = redactedVal;
              }
            }
          }
        }

        // Targeted Attributes Sanitization
        // Note: data-* attributes are NOT in targetAttributes, preserving mapping integrity!
        this.options.targetAttributes.forEach((attrName) => {
          if (node.hasAttribute(attrName)) {
            const originalVal = node.getAttribute(attrName);
            if (attrName === "href") {
              node.setAttribute(attrName, redactHref(originalVal, stats));
            } else {
              node.setAttribute(attrName, redactString(originalVal, stats));
            }
          }
        });

        // Traverse child nodes
        const children = Array.from(node.childNodes);
        for (let i = 0; i < children.length; i++) {
          this.traverseAndSanitize(children[i], stats);
        }
      }
    }

    /**
     * In-place redaction on the live DOM tree.
     * Records all modifications in an undoList and tracks PII stats.
     * Skips extension overlay elements and script/style tags.
     * @param {Node} rootNode
     * @param {{extraTerms?: string[], profile?: object}} [opts]
     *   extraTerms: PII strings from the offscreen engine;
     *   profile: the user's own values, compiled with DOMRedactor.compileProfile()
     * @returns {{undoList: Array<object>, stats: object, profileMatches: Object<string,number>}}
     *   profileMatches: redaction count per profile key (keys only, no values)
     */
    redactLiveDOM(rootNode = (document.body || document.documentElement), opts = {}) {
      const terms = compileTerms(opts.extraTerms);
      const profile = opts.profile || null;
      const profileMatches = {};
      const stats = {
        profile: 0,
        entity: 0,
        password: 0,
        aadhaar: 0,
        indianPassport: 0,
        ifsc: 0,
        pan: 0,
        vehicleRegistration: 0,
        email: 0,
        phone: 0,
        creditCard: 0,
        username: 0,
        ssn: 0,
        jwt: 0,
        bearer: 0,
        apiKey: 0,
        total: 0,
      };
      // Non-enumerable so the per-type totals below (and callers summing
      // numeric stats) never see it
      Object.defineProperty(stats, "profileMatches", { value: profileMatches });
      const undoList = [];

      const traverse = (node) => {
        if (!node) return;

        // Skip script, style, and PrivSight extension UI elements
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName.toLowerCase();
          if (tag === "script" || tag === "style") return;
          if (
            node.id === "privsight-overlay" ||
            node.id === "privsight-hint-container" ||
            (typeof node.classList?.contains === "function" &&
              (node.classList.contains("privsight-shell") ||
               node.classList.contains("llm-hint-badge")))
          ) {
            return;
          }
        }

        // 1. Text Node Handling
        if (node.nodeType === Node.TEXT_NODE) {
          if (this.options.redactTextNodes && node.nodeValue) {
            const originalVal = node.nodeValue;
            const redactedVal = redactString(originalVal, stats, terms, profile);
            if (redactedVal !== originalVal) {
              node.nodeValue = redactedVal;
              undoList.push({ type: "text", node, value: originalVal });
            }
          }
          return;
        }

        // 2. Element Node Handling
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tagName = node.tagName.toLowerCase();

          if (tagName === "input" || tagName === "textarea") {
            const type = (node.getAttribute("type") || "text").toLowerCase();
            const originalPropValue = node.value;
            const hadAttr = node.hasAttribute("value");
            const originalAttrValue = node.getAttribute("value");
            let changed = false;

            if (type === "password") {
              if (hadAttr && originalAttrValue !== "[REDACTED]") {
                node.setAttribute("value", "[REDACTED]");
                stats.password++;
                changed = true;
              }
              if (originalPropValue !== "[REDACTED]") {
                node.value = "[REDACTED]";
                changed = true;
              }
            } else {
              const nameAttr = (node.getAttribute("name") || "").toLowerCase();
              const idAttr = (node.getAttribute("id") || "").toLowerCase();
              const placeholderAttr = (node.getAttribute("placeholder") || "").toLowerCase();
              const autocompleteAttr = (node.getAttribute("autocomplete") || "").toLowerCase();

              const isSecretField =
                nameAttr.includes("password") ||
                idAttr.includes("password") ||
                autocompleteAttr.includes("password");
              const isApiKeyField =
                nameAttr.includes("api") ||
                idAttr.includes("api") ||
                nameAttr.includes("key") ||
                idAttr.includes("key") ||
                nameAttr.includes("token") ||
                idAttr.includes("token") ||
                nameAttr.includes("secret") ||
                idAttr.includes("secret");
              const isUsernameField =
                nameAttr.includes("username") ||
                idAttr.includes("username") ||
                nameAttr.includes("user_name") ||
                idAttr.includes("name") ||
                idAttr.includes("holder") ||
                nameAttr.includes("holder") ||
                nameAttr.includes("owner") ||
                idAttr.includes("owner");

              if (isSecretField) {
                if (hadAttr && originalAttrValue !== "[REDACTED]") {
                  node.setAttribute("value", "[REDACTED]");
                  stats.password++;
                  changed = true;
                }
                if (originalPropValue !== "[REDACTED]") {
                  node.value = "[REDACTED]";
                  changed = true;
                }
              } else if (isApiKeyField) {
                if (hadAttr && originalAttrValue) {
                  node.setAttribute("value", "[REDACTED]");
                  stats.apiKey++;
                  changed = true;
                }
                if (originalPropValue) {
                  node.value = "[REDACTED]";
                  changed = true;
                }
              } else if (isUsernameField) {
                if (hadAttr && originalAttrValue) {
                  node.setAttribute("value", "[REDACTED]");
                  stats.username++;
                  changed = true;
                }
                if (originalPropValue) {
                  node.value = "[REDACTED]";
                  changed = true;
                }
              } else {
                if (originalPropValue) {
                  const redacted = redactString(originalPropValue, stats, terms, profile);
                  if (redacted !== originalPropValue) {
                    node.value = redacted;
                    changed = true;
                  }
                }
                if (hadAttr && originalAttrValue) {
                  const redactedAttr = redactString(originalAttrValue, stats, terms, profile);
                  if (redactedAttr !== originalAttrValue) {
                    node.setAttribute("value", redactedAttr);
                    changed = true;
                  }
                }
              }
            }

            if (changed) {
              undoList.push({
                type: "input",
                node,
                propValue: originalPropValue,
                hadAttr,
                attrValue: originalAttrValue,
              });
            }
          }

          // Targeted Attributes Sanitization
          this.options.targetAttributes.forEach((attrName) => {
            if (node.hasAttribute(attrName)) {
              const originalVal = node.getAttribute(attrName);
              let redactedVal;
              if (attrName === "href") {
                redactedVal = redactHref(originalVal, stats, terms, profile);
              } else {
                redactedVal = redactString(originalVal, stats, terms, profile);
              }
              if (redactedVal !== originalVal) {
                node.setAttribute(attrName, redactedVal);
                undoList.push({
                  type: "attr",
                  node,
                  attrName,
                  value: originalVal,
                });
              }
            }
          });

          // Traverse child nodes
          const children = Array.from(node.childNodes);
          for (let i = 0; i < children.length; i++) {
            traverse(children[i]);
          }
        }
      };

      traverse(rootNode);

      stats.total = Object.keys(stats)
        .filter((k) => k !== "total")
        .reduce((acc, curr) => acc + stats[curr], 0);

      return { undoList, stats, profileMatches };
    }

    /**
     * Restores all modified nodes in the live DOM using the undoList in reverse order.
     * @param {Array<object>} undoList
     */
    restoreLiveDOM(undoList) {
      if (!Array.isArray(undoList)) return;
      for (let i = undoList.length - 1; i >= 0; i--) {
        const item = undoList[i];
        try {
          if (item.type === "text") {
            item.node.nodeValue = item.value;
          } else if (item.type === "input") {
            item.node.value = item.propValue;
            if (item.hadAttr) {
              item.node.setAttribute("value", item.attrValue);
            } else {
              item.node.removeAttribute("value");
            }
          } else if (item.type === "attr") {
            item.node.setAttribute(item.attrName, item.value);
          }
        } catch (err) {
          console.warn("[PrivSight DOMRedactor] Error restoring DOM node:", err);
        }
      }
    }

    /**
     * Helper method to export/download a DOM document as an HTML file.
     * @param {string|Document} domSource
     * @param {string} filename
     */
    static exportDOMFile(domSource, filename = "sanitized_dom.html") {
      let content = "";
      if (typeof domSource === "string") {
        content = domSource;
      } else if (domSource && domSource.documentElement) {
        content = domSource.doctype
          ? `<!DOCTYPE ${domSource.doctype.name}>\n${domSource.documentElement.outerHTML}`
          : domSource.documentElement.outerHTML;
      } else {
        throw new Error("Invalid DOM source for file export.");
      }

      const blob = new Blob([content], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }

  // Expose helper functions and class
  DOMRedactor.isValidLuhn = isValidLuhn;
  DOMRedactor.redactString = redactString;
  DOMRedactor.compileTerms = compileTerms;
  DOMRedactor.compileProfile = compileProfile;
  DOMRedactor.findPII = findPII;

  return DOMRedactor;
});
