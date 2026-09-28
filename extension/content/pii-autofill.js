/* Local-only, conservative PII form autofill. No network or backend calls. */
(() => {
  'use strict';

  const AUTOFILL_ENABLED = true;
  const CONFIG = globalThis.PrivSightPIIConfig;
  if (!AUTOFILL_ENABLED || !CONFIG || globalThis.PrivSightPIIAutofill) return;

  const FIELD_MAPPINGS = {
    fullName: ['name of the student', 'student name', 'full name', 'fullname', 'your name', 'legal name', 'name'],
    firstName: ['first name', 'firstname', 'given name', 'givenname', 'forename'],
    middleName: ['middle name', 'middlename'],
    lastName: ['last name', 'lastname', 'surname', 'family name'],
    preferredName: ['preferred name', 'nickname'],
    email: ['email address', 'e-mail', 'email', 'mail'],
    secondaryEmail: ['secondary email', 'alternate email', 'work email'],
    phone: ['phone number', 'telephone', 'mobile number', 'contact number', 'phone', 'mobile', 'tel'],
    secondaryPhone: ['secondary phone', 'alternate phone'],
    whatsapp: ['whatsapp'],
    dateOfBirth: ['date of birth', 'birth date', 'birthday', 'dob'],
    gender: ['gender', 'sex'], nationality: ['nationality'],
    addressLine1: ['address line 1', 'street address', 'address'],
    addressLine2: ['address line 2'], apartment: ['apartment', 'suite', 'unit'], street: ['street'],
    locality: ['locality', 'neighborhood', 'district'], city: ['city', 'town'],
    state: ['state', 'province', 'region'], country: ['country', 'nation'],
    pinCode: ['postal code', 'postcode', 'zip code', 'zipcode', 'pin code', 'pincode', 'zip', 'pin'],
    aadhaar: ['aadhaar number', 'aadhaar', 'aadhar'], pan: ['permanent account number', 'pan number', 'pan'],
    passportNumber: ['passport number', 'passport'], passportExpiry: ['passport expiry', 'passport expiration'],
    drivingLicence: ['driving licence', 'driving license', 'licence number', 'license number'],
    voterId: ['voter id', 'voter identification'], bankAccount: ['bank account number', 'bank account', 'account number'],
    ifsc: ['ifsc code', 'ifsc'], bankName: ['bank name'], branch: ['bank branch'], upiId: ['upi address', 'upi id', 'upi'],
    studentId: ['university seat number', 'usn', 'student registration number', 'student number', 'student id'],
    registrationNumber: ['registration number'], college: ['college', 'university', 'institution'],
    course: ['course', 'degree program'], educationBranch: ['academic branch', 'branch', 'stream'],
    year: ['year of study', 'student year', 'year'], semester: ['semester'],
    graduationYear: ['graduation year', 'year of graduation'], company: ['company', 'organization', 'organisation', 'employer'],
    jobTitle: ['job title', 'designation', 'position', 'job role'], department: ['department'], employeeId: ['employee id'],
    workEmail: ['work email', 'business email'], workPhone: ['work phone', 'business phone'],
    github: ['github'], linkedin: ['linkedin'], portfolio: ['portfolio'], personalWebsite: ['personal website'],
    instagram: ['instagram'], twitter: ['twitter', 'x handle'], bio: ['bio', 'biography'], referralCode: ['referral code'],
  };

  const AUTOCOMPLETE_MAPPING = {
    'given-name': 'firstName', 'additional-name': 'middleName', 'family-name': 'lastName', name: 'fullName',
    nickname: 'preferredName', email: 'email', tel: 'phone', 'tel-national': 'phone',
    'street-address': 'addressLine1', 'address-line1': 'addressLine1', 'address-line2': 'addressLine2',
    'address-level2': 'city', 'address-level1': 'state', 'postal-code': 'pinCode', country: 'country',
    'country-name': 'country', bday: 'dateOfBirth', organization: 'company', 'organization-title': 'jobTitle',
  };

  const FORBIDDEN = /(?:password|passwd|one[\s_-]*time|\botp\b|\bcvv\b|\bcvc\b|security[\s_-]*code|authentication[\s_-]*code|recovery[\s_-]*code|(?:atm|debit|card|security)[\s_-]*pin)/i;
  const PROCESSED = new WeakMap();
  const FILLED = new WeakSet();
  const ownValues = new WeakMap();
  let scheduled = false;
  const pendingRoots = new Set();
  let missingInfoNoticeShown = false;

  function normalize(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  }

  function configValue(key) {
    // Keep these student-specific fields bound to the education profile so a
    // similarly named financial/other field can never supply their values.
    if (key === 'studentId') return CONFIG.education?.studentId || '';
    if (key === 'educationBranch') return CONFIG.education?.branch || '';
    for (const group of Object.values(CONFIG)) {
      if (group && Object.prototype.hasOwnProperty.call(group, key)) return group[key];
    }
    return '';
  }

  function metadata(field) {
    // Keep autocomplete and input type separate so neither can override a conflicting label.
    const ownParts = [field.name, field.id, field.placeholder, field.getAttribute('aria-label')];
    const labels = [];
    if (field.labels) labels.push(...Array.from(field.labels, label => label.innerText || label.textContent));
    const labelledBy = field.getAttribute('aria-labelledby');
    if (labelledBy) {
      labelledBy.split(/\s+/).forEach(id => {
        const label = field.ownerDocument.getElementById(id);
        if (label) labels.push(label.innerText || label.textContent);
      });
    }
    if (!field.labels?.length && field.id) {
      try {
        const label = field.ownerDocument.querySelector(`label[for="${CSS.escape(field.id)}"]`);
        if (label) labels.push(label.innerText || label.textContent);
      } catch (_) {}
    }
    if (field.closest('label')) labels.push(field.closest('label').innerText || field.closest('label').textContent);
    return {
      text: normalize(ownParts.join(' ')),
      labelText: normalize(labels.join(' ')),
      forbiddenText: normalize([ownParts.join(' '), labels.join(' '), field.type].join(' ')),
      autocomplete: normalize(field.autocomplete).split(' ').pop(),
    };
  }

  function classify(field) {
    const meta = metadata(field);
    if (FORBIDDEN.test(meta.forbiddenText)) return null;
    if (/\bpin\b/.test(meta.text) && !/\b(?:postal|zip|post code|pincode)\b/.test(meta.text)) return null;
    function bestMatch(text) {
      const candidates = [];
      for (const [key, terms] of Object.entries(FIELD_MAPPINGS)) {
        for (const term of terms) {
          const normalizedTerm = normalize(term);
          if (normalizedTerm && (` ${text} `).includes(` ${normalizedTerm} `)) candidates.push({ key, score: normalizedTerm.length });
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      const ambiguous = candidates.length > 1 && candidates[0].score === candidates[1].score && candidates[0].key !== candidates[1].key;
      return { key: candidates.length && !ambiguous ? candidates[0].key : null, ambiguous };
    }

    // Explicit labels are strongest. Identifiers like i39 only participate if
    // they contain a recognized field term. Avoid broad parent text: a form
    // container often includes labels for several unrelated inputs.
    const labelMatch = bestMatch(meta.labelText);
    const ownMatch = bestMatch(meta.text);
    const localMatch = labelMatch.key ? labelMatch : ownMatch;
    const semanticKey = localMatch.key;
    const autoKey = AUTOCOMPLETE_MAPPING[meta.autocomplete];

    // A semantic label/identifier that disagrees with autocomplete is unsafe.
    // Do not let stale or incorrect autocomplete metadata fill the wrong PII.
    if (semanticKey && autoKey && semanticKey !== autoKey) return null;
    if (semanticKey) return semanticKey;
    if (localMatch.ambiguous) return null;
    // Google Forms and similar builders use opaque IDs such as i39. Their
    // autocomplete metadata can be stale or generic, so it is not enough to
    // safely identify a field without a label.
    const opaqueId = /^(?:i\d+|entry[._-]?\d+|field[._-]?\d+)$/i;
    if (autoKey && [field.name, field.id].some(value => value && opaqueId.test(value.trim()))) return null;
    // Input type alone (for example type=email) is not enough evidence to
    // fill. A recognized autocomplete token can still identify unlabelled fields.
    return autoKey || null;
  }

  function isEligible(field) {
    if (!(field instanceof HTMLElement) || field.disabled || field.readOnly || field.getAttribute('aria-disabled') === 'true') return false;
    if (field instanceof HTMLInputElement && !['text', 'email', 'tel', 'date', 'number', 'search', 'url', 'radio'].includes(field.type)) return false;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return false;
    if (field instanceof HTMLSelectElement && field.multiple) return false;
    if (field.getAttribute('aria-hidden') === 'true' || field.closest('[aria-hidden="true"],[hidden]')) return false;
    if (field.type !== 'radio' && field.value && field.value.trim() && field.value !== ownValues.get(field)) return false;
    return true;
  }

  function formatDate(value, field) {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return value;
    const [, year, month, day] = match;
    if (field.type === 'date') return `${year}-${month}-${day}`;
    const text = normalize([field.placeholder, field.name, field.id, field.getAttribute('aria-label')].join(' '));
    if (/\b(mm dd yyyy|mm dd yyyy|month day year)\b/.test(text)) return `${month}/${day}/${year}`;
    if (/\b(dd mm yyyy|day month year)\b/.test(text)) return `${day}/${month}/${year}`;
    return `${year}-${month}-${day}`;
  }

  function optionValue(select, value) {
    const wanted = normalize(value);
    const options = Array.from(select.options).filter(option => !option.disabled);
    const match = options.find(option => normalize(option.textContent) === wanted || normalize(option.value) === wanted);
    return match ? match.value : '';
  }

  function setNativeValue(field, value) {
    const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(field, value); else field.value = value;
    ownValues.set(field, value);
    for (const eventName of ['input', 'change', 'blur']) {
      field.dispatchEvent(new Event(eventName, { bubbles: true, composed: true }));
    }
  }

  function showMissingInfoNotice() {
    if (missingInfoNoticeShown || !document.documentElement) return;
    missingInfoNoticeShown = true;

    const host = document.createElement('div');
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('role', 'status');
    Object.assign(host.style, {
      position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', pointerEvents: 'none',
    });
    const shadow = host.attachShadow({ mode: 'closed' });
    const notice = document.createElement('div');
    notice.textContent = "Some fields were left blank because that information isn't in your local profile. PrivSight only fills information you've provided.";
    Object.assign(notice.style, {
      maxWidth: 'min(520px, calc(100vw - 32px))', padding: '12px 16px',
      borderRadius: '10px', background: '#172033', color: '#f8fafc',
      border: '1px solid #475569', boxShadow: '0 8px 28px rgba(0,0,0,.28)',
      font: '500 13px/1.45 system-ui, sans-serif', textAlign: 'center',
    });
    shadow.appendChild(notice);
    document.documentElement.appendChild(host);
    setTimeout(() => host.remove(), 6500);
  }

  function process(field) {
    if (FILLED.has(field)) return;
    if (!isEligible(field)) return;
    const mapping = classify(field);
    PROCESSED.set(field, mapping || '');
    if (!mapping) return;
    let value = configValue(mapping);
    // `country` autocomplete is a name in some forms; country-name can use the same config.
    if (typeof value !== 'string' || !value.trim()) {
      showMissingInfoNotice();
      return;
    }
    if (field instanceof HTMLInputElement && field.type === 'radio') {
      const radios = Array.from((field.form || document).querySelectorAll('input[type="radio"]'))
        .filter(radio => field.name ? radio.name === field.name : radio === field);
      if (radios.some(radio => radio.checked)) return;
      const wanted = normalize(value);
      const match = radios.find(radio => {
        const label = radio.labels?.[0];
        return normalize(radio.value) === wanted || normalize(label?.innerText || label?.textContent) === wanted;
      });
      if (!match) return;
      match.checked = true;
      ownValues.set(match, match.value);
      FILLED.add(match);
      match.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      match.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      console.info(`[PrivSight Autofill] filled ${mapping} (radio)`);
      return;
    }
    if (field.type === 'date' || mapping === 'dateOfBirth') value = formatDate(value, field);
    if (field instanceof HTMLSelectElement) {
      value = optionValue(field, value);
      if (!value) return;
    }
    setNativeValue(field, value);
    FILLED.add(field);
    console.info(`[PrivSight Autofill] filled ${mapping} (${field.tagName.toLowerCase()})`);
  }

  function scan(root) {
    if (root instanceof Element && root.matches('input, textarea, select') && !PROCESSED.has(root)) process(root);
    if (!root.querySelectorAll) return;
    root.querySelectorAll('input, textarea, select').forEach(field => {
      // Previously-filled fields are skipped; fields that were empty/ambiguous can be reconsidered
      // when relevant metadata/options change, while never replacing user-entered text.
      if (!PROCESSED.has(field) || (!field.value && PROCESSED.get(field) !== '')) process(field);
    });
  }

  function scheduleScan(root) {
    if (root?.nodeType === Node.ELEMENT_NODE) pendingRoots.add(root);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const roots = Array.from(pendingRoots);
      pendingRoots.clear();
      roots.forEach(node => { if (node.isConnected) scan(node); });
    });
  }

  function start() {
    if (!document.documentElement) return;
    scan(document);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') record.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) scheduleScan(node);
        });
        else if (record.type === 'attributes' && record.target.matches?.('input, textarea, select')) {
          if (!record.target.value || record.target.value === ownValues.get(record.target)) process(record.target);
        }
      }
    });
    observer.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['name', 'id', 'type', 'placeholder', 'aria-label', 'autocomplete', 'disabled', 'readonly'],
    });
  }

  globalThis.PrivSightPIIAutofill = Object.freeze({ start });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
