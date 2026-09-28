/* Local-only, conservative PII form autofill. No network or backend calls. */
(() => {
  'use strict';

  const AUTOFILL_ENABLED = true;
  const CONFIG = globalThis.PrivSightPIIConfig;
  if (!AUTOFILL_ENABLED || !CONFIG || globalThis.PrivSightPIIAutofill) return;

  const FIELD_MAPPINGS = {
    fullName: ['full name', 'fullname', 'your name', 'legal name', 'name'],
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
    studentId: ['student registration number', 'student number', 'student id'],
    registrationNumber: ['registration number'], college: ['college', 'university', 'institution'],
    course: ['course', 'degree program'], educationBranch: ['academic branch', 'branch', 'stream'], semester: ['semester'],
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

  function normalize(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  }

  function configValue(key) {
    if (key === 'educationBranch') return CONFIG.education?.branch || '';
    for (const group of Object.values(CONFIG)) {
      if (group && Object.prototype.hasOwnProperty.call(group, key)) return group[key];
    }
    return '';
  }

  function metadata(field) {
    const ownParts = [field.name, field.id, field.type, field.placeholder, field.getAttribute('aria-label'), field.autocomplete];
    if (field.labels) ownParts.push(...Array.from(field.labels, label => label.innerText || label.textContent));
    if (!field.labels?.length && field.id) {
      try {
        const label = field.ownerDocument.querySelector(`label[for="${CSS.escape(field.id)}"]`);
        if (label) ownParts.push(label.innerText || label.textContent);
      } catch (_) {}
    }
    const parent = field.closest('label') || field.parentElement;
    return {
      text: normalize(ownParts.join(' ')),
      context: normalize(parent?.innerText || parent?.textContent || ''),
      forbiddenText: normalize(ownParts.join(' ')),
      autocomplete: normalize(field.autocomplete).split(' ').pop(),
    };
  }

  function classify(field) {
    const meta = metadata(field);
    if (FORBIDDEN.test(meta.forbiddenText)) return null;
    if (/\bpin\b/.test(meta.text) && !/\b(?:postal|zip|post code|pincode)\b/.test(meta.text)) return null;
    const autoKey = AUTOCOMPLETE_MAPPING[meta.autocomplete];
    if (autoKey) return autoKey;
    const text = meta.text;
    // Prefer narrow/multiword matches to prevent e.g. "name" winning over "company name".
    const candidates = [];
    for (const [key, terms] of Object.entries(FIELD_MAPPINGS)) {
      for (const term of terms) {
        const normalizedTerm = normalize(term);
        if (normalizedTerm && (` ${text} `).includes(` ${normalizedTerm} `)) candidates.push({ key, score: normalizedTerm.length });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    if (candidates.length && !(candidates.length > 1 && candidates[0].score === candidates[1].score && candidates[0].key !== candidates[1].key)) return candidates[0].key;
    // Use broad container text only as a fallback, and only if it identifies one mapping.
    if (candidates.length) return null;
    const contextual = [];
    for (const [key, terms] of Object.entries(FIELD_MAPPINGS)) {
      for (const term of terms) {
        const normalizedTerm = normalize(term);
        if (normalizedTerm && (` ${meta.context} `).includes(` ${normalizedTerm} `)) contextual.push({ key, score: normalizedTerm.length });
      }
    }
    contextual.sort((a, b) => b.score - a.score);
    if (!contextual.length || (contextual.length > 1 && contextual[0].score === contextual[1].score && contextual[0].key !== contextual[1].key)) return null;
    return contextual[0].key;
  }

  function isEligible(field) {
    if (!(field instanceof HTMLElement) || field.disabled || field.readOnly || field.getAttribute('aria-disabled') === 'true') return false;
    if (field instanceof HTMLInputElement && !['text', 'email', 'tel', 'date', 'number', 'search', 'url'].includes(field.type)) return false;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)) return false;
    if (field instanceof HTMLSelectElement && field.multiple) return false;
    if (field.getAttribute('aria-hidden') === 'true' || field.closest('[aria-hidden="true"],[hidden]')) return false;
    if (field.value && field.value.trim() && field.value !== ownValues.get(field)) return false;
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

  function process(field) {
    if (FILLED.has(field)) return;
    if (!isEligible(field)) return;
    const mapping = classify(field);
    PROCESSED.set(field, mapping || '');
    if (!mapping) return;
    let value = configValue(mapping);
    // `country` autocomplete is a name in some forms; country-name can use the same config.
    if (typeof value !== 'string' || !value.trim()) return;
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
