/*
 * Local-only, conservative PII form autofill.
 * No network or backend calls.
 */
(() => {
  'use strict';

  const AUTOFILL_ENABLED = true;
  const SCHEMA = globalThis.PrivSightPIISchema;

  if (!AUTOFILL_ENABLED || !SCHEMA || globalThis.PrivSightPIIAutofill) return;

  const STORAGE_KEYS = SCHEMA.storageKeys;
  const SENSITIVE = new Set(SCHEMA.sensitiveKeys);

  // Loaded from chrome.storage.local; empty until the user fills in their profile.
  let profile = {};
  let settings = { ...SCHEMA.defaultSettings };

  const FIELD_MAPPINGS = {
    fullName: [
      'name of the student',
      'student name',
      'full name',
      'fullname',
      'your name',
      'legal name',
      'name'
    ],

    firstName: [
      'first name',
      'firstname',
      'given name',
      'givenname',
      'forename'
    ],

    middleName: [
      'middle name',
      'middlename'
    ],

    lastName: [
      'last name',
      'lastname',
      'surname',
      'family name'
    ],

    preferredName: [
      'preferred name',
      'nickname'
    ],

    email: [
      'email address',
      'e-mail',
      'email',
      'mail'
    ],

    secondaryEmail: [
      'secondary email',
      'alternate email'
    ],

    phone: [
      'phone number',
      'telephone',
      'mobile number',
      'contact number',
      'phone',
      'mobile',
      'tel'
    ],

    secondaryPhone: [
      'secondary phone',
      'alternate phone'
    ],

    whatsapp: [
      'whatsapp'
    ],

    dateOfBirth: [
      'date of birth',
      'birth date',
      'birthday',
      'dob'
    ],

    gender: [
      'gender',
      'sex'
    ],

    nationality: [
      'nationality'
    ],

    addressLine1: [
      'address line 1',
      'street address',
      'address'
    ],

    addressLine2: [
      'address line 2'
    ],

    apartment: [
      'apartment',
      'suite',
      'unit'
    ],

    street: [
      'street'
    ],

    locality: [
      'locality',
      'neighborhood',
      'district'
    ],

    city: [
      'city',
      'town'
    ],

    state: [
      'state',
      'province',
      'region'
    ],

    country: [
      'country',
      'nation'
    ],

    pinCode: [
      'postal code',
      'postcode',
      'zip code',
      'zipcode',
      'pin code',
      'pincode',
      'zip',
      'pin'
    ],

    aadhaar: [
      'aadhaar number',
      'aadhaar',
      'aadhar'
    ],

    pan: [
      'permanent account number',
      'pan number',
      'pan'
    ],

    passportNumber: [
      'passport number',
      'passport'
    ],

    passportExpiry: [
      'passport expiry',
      'passport expiration'
    ],

    drivingLicence: [
      'driving licence',
      'driving license',
      'licence number',
      'license number'
    ],

    voterId: [
      'voter id',
      'voter identification'
    ],

    bankAccount: [
      'bank account number',
      'bank account',
      'account number'
    ],

    ifsc: [
      'ifsc code',
      'ifsc'
    ],

    bankName: [
      'bank name'
    ],

    branch: [
      'bank branch'
    ],

    upiId: [
      'upi address',
      'upi id',
      'upi'
    ],

    studentId: [
      'university seat number',
      'usn',
      'student registration number',
      'student number',
      'student id'
    ],

    registrationNumber: [
      'registration number'
    ],

    college: [
      'college',
      'university',
      'institution'
    ],

    course: [
      'course',
      'degree program'
    ],

    educationBranch: [
      'academic branch',
      'branch',
      'stream'
    ],

    year: [
      'year of study',
      'student year',
      'year'
    ],

    semester: [
      'semester'
    ],

    graduationYear: [
      'graduation year',
      'year of graduation'
    ],

    company: [
      'company',
      'organization',
      'organisation',
      'employer'
    ],

    jobTitle: [
      'job title',
      'designation',
      'position',
      'job role'
    ],

    department: [
      'department'
    ],

    employeeId: [
      'employee id'
    ],

    workEmail: [
      'work email',
      'business email'
    ],

    workPhone: [
      'work phone',
      'business phone'
    ],

    github: [
      'github'
    ],

    linkedin: [
      'linkedin'
    ],

    portfolio: [
      'portfolio'
    ],

    personalWebsite: [
      'personal website'
    ],

    instagram: [
      'instagram'
    ],

    twitter: [
      'twitter',
      'x handle'
    ],

    bio: [
      'bio',
      'biography'
    ],

    referralCode: [
      'referral code'
    ]
  };

  const AUTOCOMPLETE_MAPPING = {
    'given-name': 'firstName',
    'additional-name': 'middleName',
    'family-name': 'lastName',
    name: 'fullName',
    nickname: 'preferredName',
    email: 'email',
    tel: 'phone',
    'tel-national': 'phone',
    'street-address': 'addressLine1',
    'address-line1': 'addressLine1',
    'address-line2': 'addressLine2',
    'address-level2': 'city',
    'address-level1': 'state',
    'postal-code': 'pinCode',
    country: 'country',
    'country-name': 'country',
    bday: 'dateOfBirth',
    organization: 'company',
    'organization-title': 'jobTitle'
  };

  /*
   * Authentication secrets remain blocked:
   * OTP, CVV, CVC, security codes, recovery codes and PINs.
   */
  const FORBIDDEN =
    /(?:password|passwd|passcode|one[\s_-]*time|\botp\b|cvv|cvc|security[\s_-]*code|authentication[\s_-]*code|recovery[\s_-]*code|(?:atm|debit|card|security)[\s_-]*pin)/i;

  const PROCESSED = new WeakMap();
  const FILLED = new WeakSet();
  const ownValues = new WeakMap();

  let scheduled = false;
  const pendingRoots = new Set();
  const shownNotices = new Set();
  let observer = null;
  let pausedForHumanInput = false;

  function normalize(value) {
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  /*
   * Custom profile keys (added on the profile page beyond the built-in fields)
   * extend FIELD_MAPPINGS without code changes:
   *  - a key whose name is already a built-in term ("name", "address") is an
   *    alias: it fills that built-in field when the built-in value is empty;
   *  - any other key maps to fields labelled with its own name
   *    ("libraryCard" → "Library card" / name="librarycard").
   */
  let mappingEntries = Object.entries(FIELD_MAPPINGS);
  let aliases = {}; // built-in key -> custom keys that stand in for it

  function rebuildMappings() {
    const custom = [];
    aliases = {};
    for (const key of Object.keys(profile)) {
      if (key in FIELD_MAPPINGS || !SCHEMA.isCustomKey(key)) continue;
      const label = normalize(SCHEMA.keyToLabel(key));
      if (label.length < 3) continue;
      const owner = Object.keys(FIELD_MAPPINGS).find(
        builtIn => FIELD_MAPPINGS[builtIn].some(term => normalize(term) === label)
      );
      if (owner) {
        (aliases[owner] = aliases[owner] || []).push(key);
        continue;
      }
      custom.push([key, [...new Set([label, label.replace(/ /g, '')])]]);
    }
    mappingEntries = [...Object.entries(FIELD_MAPPINGS), ...custom];
  }

  function configValue(key) {
    const own = profile[key];
    if (typeof own === 'string' && own.trim()) return own;
    for (const alias of aliases[key] || []) {
      const value = profile[alias];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return '';
  }

  function hasAnyProfileValue() {
    return Object.values(profile).some(
      value => typeof value === 'string' && value.trim()
    );
  }

  function sensitiveAllowedHere() {
    return settings.sensitiveSites.includes(location.origin);
  }

  function applyStored(items) {
    const storedProfile = items?.[STORAGE_KEYS.profile];
    const storedSettings = items?.[STORAGE_KEYS.settings];

    profile =
      storedProfile && typeof storedProfile === 'object'
        ? storedProfile
        : {};
    rebuildMappings();

    settings = {
      enabled: storedSettings?.enabled !== false,
      sensitiveSites: Array.isArray(storedSettings?.sensitiveSites)
        ? storedSettings.sensitiveSites
        : []
    };
  }

  function metadata(field) {
    const ownParts = [
      field.name,
      field.id,
      field.placeholder,
      field.getAttribute('aria-label')
    ];

    const labels = [];

    if (field.labels) {
      labels.push(
        ...Array.from(
          field.labels,
          label => label.innerText || label.textContent
        )
      );
    }

    const labelledBy = field.getAttribute('aria-labelledby');

    if (labelledBy) {
      labelledBy.split(/\s+/).forEach(id => {
        const label = field.ownerDocument.getElementById(id);

        if (label) {
          labels.push(
            label.innerText || label.textContent
          );
        }
      });
    }

    if (!field.labels?.length && field.id) {
      try {
        const label = field.ownerDocument.querySelector(
          `label[for="${CSS.escape(field.id)}"]`
        );

        if (label) {
          labels.push(
            label.innerText || label.textContent
          );
        }
      } catch (_) {}
    }

    if (field.closest('label')) {
      labels.push(
        field.closest('label').innerText ||
        field.closest('label').textContent
      );
    }

    return {
      text: normalize(ownParts.join(' ')),

      labelText: normalize(
        labels.join(' ')
      ),

      forbiddenText: normalize(
        [
          ownParts.join(' '),
          labels.join(' '),
          field.type
        ].join(' ')
      ),

      autocomplete: normalize(
        field.autocomplete
      ).split(' ').pop()
    };
  }

  function classify(field) {
    const meta = metadata(field);

    if (FORBIDDEN.test(meta.forbiddenText)) {
      return null;
    }

    // A bare "PIN" (in attributes or visible label) is treated as a secret
    // unless it is clearly a postal code.
    const pinText = `${meta.text} ${meta.labelText}`;

    if (
      /\bpin\b/.test(pinText) &&
      !/\b(?:postal|zip|post code|pincode|pin code)\b/.test(pinText)
    ) {
      return null;
    }

    function bestMatch(text) {
      const candidates = [];

      for (const [key, terms] of mappingEntries) {
        for (const term of terms) {
          const normalizedTerm = normalize(term);

          if (
            normalizedTerm &&
            (` ${text} `).includes(
              ` ${normalizedTerm} `
            )
          ) {
            candidates.push({
              key,
              score: normalizedTerm.length
            });
          }
        }
      }

      candidates.sort(
        (a, b) => b.score - a.score
      );

      const ambiguous =
        candidates.length > 1 &&
        candidates[0].score === candidates[1].score &&
        candidates[0].key !== candidates[1].key;

      return {
        key:
          candidates.length && !ambiguous
            ? candidates[0].key
            : null,
        ambiguous
      };
    }

    const labelMatch =
      bestMatch(meta.labelText);

    const ownMatch =
      bestMatch(meta.text);

    const localMatch =
      labelMatch.key
        ? labelMatch
        : ownMatch;

    const semanticKey =
      localMatch.key;

    const autoKey =
      AUTOCOMPLETE_MAPPING[
        meta.autocomplete
      ];

    if (
      semanticKey &&
      autoKey &&
      semanticKey !== autoKey
    ) {
      return null;
    }

    if (semanticKey) {
      return semanticKey;
    }

    if (localMatch.ambiguous) {
      return null;
    }

    const opaqueId =
      /^(?:i\d+|entry[._-]?\d+|field[._-]?\d+)$/i;

    if (
      autoKey &&
      [field.name, field.id].some(
        value =>
          value &&
          opaqueId.test(value.trim())
      )
    ) {
      return null;
    }

    return autoKey || null;
  }

  // `consent`: the user just said "yes, autofill" for this page in the side
  // panel, so the human-input pause doesn't apply to this one fill.
  function isEligible(field, consent = false) {
    if ((pausedForHumanInput && !consent) || !settings.enabled) return false;
    if (
      !(field instanceof HTMLElement) ||
      field.disabled ||
      field.readOnly ||
      field.getAttribute('aria-disabled') === 'true'
    ) {
      return false;
    }

    if (
      field instanceof HTMLInputElement &&
      ![
        'text',
        'email',
        'tel',
        'date',
        'number',
        'search',
        'url',
        'radio'
      ].includes(field.type)
    ) {
      return false;
    }

    if (
      !(
        field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement ||
        field instanceof HTMLSelectElement
      )
    ) {
      return false;
    }

    if (
      field instanceof HTMLSelectElement &&
      field.multiple
    ) {
      return false;
    }

    if (
      field.getAttribute('aria-hidden') === 'true' ||
      field.closest('[aria-hidden="true"],[hidden]')
    ) {
      return false;
    }

    if (
      field.type !== 'radio' &&
      field.value &&
      field.value.trim() &&
      field.value !== ownValues.get(field)
    ) {
      return false;
    }

    return true;
  }

  function formatDate(value, field) {
    const match =
      String(value).match(
        /^(\d{4})-(\d{2})-(\d{2})$/
      );

    if (!match) {
      return value;
    }

    const [, year, month, day] =
      match;

    if (field.type === 'date') {
      return `${year}-${month}-${day}`;
    }

    const text = normalize([
      field.placeholder,
      field.name,
      field.id,
      field.getAttribute('aria-label')
    ].join(' '));

    if (
      /\b(mm dd yyyy|month day year)\b/.test(text)
    ) {
      return `${month}/${day}/${year}`;
    }

    if (
      /\b(dd mm yyyy|day month year)\b/.test(text)
    ) {
      return `${day}/${month}/${year}`;
    }

    return `${year}-${month}-${day}`;
  }

  function optionValue(select, value) {
    const wanted = normalize(value);

    const options =
      Array.from(select.options)
        .filter(option => !option.disabled);

    const match =
      options.find(
        option =>
          normalize(option.textContent) === wanted ||
          normalize(option.value) === wanted
      );

    return match
      ? match.value
      : '';
  }

  function setNativeValue(field, value) {
    const proto =
      field instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : field instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;

    const setter =
      Object.getOwnPropertyDescriptor(
        proto,
        'value'
      )?.set;

    if (setter) {
      setter.call(field, value);
    } else {
      field.value = value;
    }

    ownValues.set(field, value);

    for (const eventName of [
      'input',
      'change',
      'blur'
    ]) {
      field.dispatchEvent(
        new Event(eventName, {
          bubbles: true,
          composed: true
        })
      );
    }
  }

  const NOTICES = {
    missing:
      "Some fields were left blank because that information isn't in your local profile. PrivSight only fills information you've provided.",
    sensitive:
      "PrivSight didn't fill ID or bank fields on this site. To allow it, open your autofill profile from the PrivSight side panel."
  };

  function showNotice(kind) {
    if (
      shownNotices.has(kind) ||
      !document.documentElement
    ) {
      return;
    }

    shownNotices.add(kind);

    const host =
      document.createElement('div');

    host.setAttribute(
      'aria-live',
      'polite'
    );

    host.setAttribute(
      'role',
      'status'
    );

    Object.assign(host.style, {
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      pointerEvents: 'none'
    });

    const shadow =
      host.attachShadow({
        mode: 'closed'
      });

    const notice =
      document.createElement('div');

    notice.textContent = NOTICES[kind];

    Object.assign(notice.style, {
      maxWidth:
        'min(520px, calc(100vw - 32px))',
      padding: '12px 16px',
      borderRadius: '10px',
      background: '#172033',
      color: '#f8fafc',
      border: '1px solid #475569',
      boxShadow:
        '0 8px 28px rgba(0,0,0,.28)',
      font:
        '500 13px/1.45 system-ui, sans-serif',
      textAlign: 'center'
    });

    shadow.appendChild(notice);
    document.documentElement.appendChild(host);

    setTimeout(
      () => host.remove(),
      6500
    );
  }

  /**
   * Fills one field from the profile. Returns the profile key it filled (or,
   * with `dryRun`, would fill), else null.
   * `consent`: one-time fill the user approved in the side panel; passwords,
   * OTPs and other secrets are still refused by classify().
   */
  function process(field, { dryRun = false, consent = false } = {}) {
    if (FILLED.has(field)) {
      return null;
    }

    if (!isEligible(field, consent)) {
      return null;
    }

    const mapping =
      classify(field);

    if (!dryRun) {
      PROCESSED.set(
        field,
        mapping || ''
      );
    }

    if (!mapping) {
      return null;
    }

    let value =
      configValue(mapping);

    if (
      typeof value !== 'string' ||
      !value.trim()
    ) {
      // Don't nag on every form before the user has set up a profile.
      if (!dryRun && hasAnyProfileValue()) showNotice('missing');
      return null;
    }

    // Page scripts can read a filled value from input/change events even if
    // the form is never submitted, so IDs and bank details need site consent.
    if (
      SENSITIVE.has(mapping) &&
      !sensitiveAllowedHere()
    ) {
      if (!dryRun) showNotice('sensitive');
      return null;
    }

    if (dryRun) {
      return mapping;
    }

    if (
      field instanceof HTMLInputElement &&
      field.type === 'radio'
    ) {
      const radios =
        Array.from(
          (field.form || document)
            .querySelectorAll(
              'input[type="radio"]'
            )
        )
        .filter(
          radio =>
            field.name
              ? radio.name === field.name
              : radio === field
        );

      if (
        radios.some(
          radio => radio.checked
        )
      ) {
        return;
      }

      const wanted =
        normalize(value);

      const match =
        radios.find(radio => {
          const label =
            radio.labels?.[0];

          return (
            normalize(radio.value) === wanted ||
            normalize(
              label?.innerText ||
              label?.textContent
            ) === wanted
          );
        });

      if (!match) {
        return;
      }

      match.checked = true;

      ownValues.set(
        match,
        match.value
      );

      FILLED.add(match);

      match.dispatchEvent(
        new Event('input', {
          bubbles: true,
          composed: true
        })
      );

      match.dispatchEvent(
        new Event('change', {
          bubbles: true,
          composed: true
        })
      );

      console.info(
        `[PrivSight Autofill] filled ${mapping} (radio)`
      );

      return mapping;
    }

    if (
      field.type === 'date' ||
      mapping === 'dateOfBirth'
    ) {
      value =
        formatDate(
          value,
          field
        );
    }

    if (
      field instanceof HTMLSelectElement
    ) {
      value =
        optionValue(
          field,
          value
        );

      if (!value) {
        return;
      }
    }

    setNativeValue(
      field,
      value
    );

    FILLED.add(field);

    console.info(
      `[PrivSight Autofill] filled ${mapping} (${field.tagName.toLowerCase()})`
    );

    return mapping;
  }

  // ── Ask-first autofill for pages PrivSight hands to the user ─────────
  // On login / verification pages automatic filling is off (see
  // isHumanInputGatePage). The side panel instead asks the user; these list
  // what could be filled (profile KEYS + labels only, never values) and do a
  // one-time fill if the user says yes. Secrets (passwords, OTPs, CVV, PINs)
  // are never fillable: classify() rejects them before any value is read.
  // Visible fields only: hidden inputs are a classic way for a page to harvest
  // autofilled data the user never sees, and the user only approved what's on screen.
  function fillableFields() {
    return Array.from(document.querySelectorAll('input, textarea, select')).filter(field => {
      if (!field.getClientRects().length) return false;
      const style = getComputedStyle(field);
      return style.visibility !== 'hidden' && style.opacity !== '0';
    });
  }

  function labelFor(key) {
    for (const group of SCHEMA.groups) {
      const hit = group.fields.find(([k]) => k === key);
      if (hit) return hit[1];
    }
    const label = SCHEMA.keyToLabel(key);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  function describe(keys) {
    const unique = [...new Set(keys)];
    return { count: keys.length, keys: unique, labels: unique.map(labelFor) };
  }

  function previewConsentFill() {
    return describe(
      fillableFields()
        .map(field => process(field, { dryRun: true, consent: true }))
        .filter(Boolean)
    );
  }

  function consentFill() {
    return describe(
      fillableFields()
        .map(field => process(field, { consent: true }))
        .filter(Boolean)
    );
  }

  function scan(root) {
    // Skip (rather than permanently stop) so SPA route changes can re-enable.
    if (pausedForHumanInput || isHumanInputGatePage()) {
      return;
    }
    if (
      root instanceof Element &&
      root.matches(
        'input, textarea, select'
      ) &&
      !PROCESSED.has(root)
    ) {
      process(root);
    }

    if (!root.querySelectorAll) {
      return;
    }

    root
      .querySelectorAll(
        'input, textarea, select'
      )
      .forEach(field => {
        if (
          !PROCESSED.has(field) ||
          (
            !field.value &&
            PROCESSED.get(field) !== ''
          )
        ) {
          process(field);
        }
      });
  }

  function scheduleScan(root) {
    if (
      root?.nodeType ===
      Node.ELEMENT_NODE
    ) {
      pendingRoots.add(root);
    }

    if (scheduled) {
      return;
    }

    scheduled = true;

    queueMicrotask(() => {
      scheduled = false;

      const roots =
        Array.from(
          pendingRoots
        );

      pendingRoots.clear();

      roots.forEach(node => {
        if (node.isConnected) {
          scan(node);
        }
      });
    });
  }

  function start() {
    if (!document.documentElement) {
      return;
    }

    observer =
      new MutationObserver(
        records => {
          for (const record of records) {
            if (
              record.type ===
              'childList'
            ) {
              record.addedNodes.forEach(
                node => {
                  if (
                    node.nodeType ===
                    Node.ELEMENT_NODE
                  ) {
                    scheduleScan(node);
                  }
                }
              );
            }

            else if (
              record.type ===
              'attributes' &&
              record.target.matches?.(
                'input, textarea, select'
              )
            ) {
              if (pausedForHumanInput || isHumanInputGatePage()) {
                return;
              }
              if (
                !record.target.value ||
                record.target.value ===
                  ownValues.get(
                    record.target
                  )
              ) {
                process(
                  record.target
                );
              }
            }
          }
        }
      );

    observer.observe(
      document.documentElement,
      {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: [
          'name',
          'id',
          'type',
          'placeholder',
          'aria-label',
          'autocomplete',
          'disabled',
          'readonly'
        ]
      }
    );

    window.addEventListener('popstate', () => scan(document));
    window.addEventListener('hashchange', () => scan(document));
    scan(document);
  }

  function isHumanInputGatePage() {
    const normalizeText = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const controls = Array.from(document.querySelectorAll('input, textarea, select'));
    const route = normalizeText(`${location.pathname} ${document.title}`);
    const fieldText = controls.map(field => {
      const labelled = field.labels ? Array.from(field.labels).map(label => label.innerText || label.textContent).join(' ') : '';
      const aria = field.getAttribute('aria-label') || '';
      const refs = (field.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || '').join(' ');
      return normalizeText([field.type, field.name, field.id, field.autocomplete, field.placeholder, labelled, aria, refs].join(' '));
    }).join(' ');
    // Only auth/verification/payment pages are off-limits. Ordinary forms with
    // personal fields are exactly what autofill is for, so they are not gated.
    const sensitiveField = controls.some(field => field.type === 'password') ||
      /\b(?:one time code|otp|verification code|captcha|credit card|card number|cvv|cvc|payment)\b/.test(fieldText);
    const privateRoute = /\b(?:login|log in|sign in|signin|checkout|payment|verify|verification)\b/.test(route);
    return sensitiveField || (controls.length > 0 && privateRoute);
  }

  // While the agent waits for the human, autofill must not touch the form.
  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PAUSE_PII_AUTOFILL_FOR_HUMAN_INPUT') {
      pausedForHumanInput = true;
      sendResponse?.({ ok: true });
    } else if (message?.type === 'RESUME_PII_AUTOFILL') {
      pausedForHumanInput = false;
      sendResponse?.({ ok: true });
    } else if (message?.type === 'PII_AUTOFILL_PREVIEW') {
      sendResponse?.({ ok: true, ...previewConsentFill() });
    } else if (message?.type === 'PII_AUTOFILL_CONSENT_FILL') {
      sendResponse?.({ ok: true, ...consentFill() });
    }
  });

  globalThis.PrivSightPIIAutofill =
    Object.freeze({
      start
    });

  // Profile edits (or a newly allowed site) apply to open tabs without reload;
  // scan() retries mapped fields that are still empty.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (
      area !== 'local' ||
      !(STORAGE_KEYS.profile in changes || STORAGE_KEYS.settings in changes)
    ) {
      return;
    }

    chrome.storage.local.get(
      [STORAGE_KEYS.profile, STORAGE_KEYS.settings],
      items => {
        applyStored(items);
        if (observer) scan(document);
      }
    );
  });

  function startWhenReady() {
    if (
      document.readyState ===
      'loading'
    ) {
      document.addEventListener(
        'DOMContentLoaded',
        start,
        { once: true }
      );
    } else {
      start();
    }
  }

  if (!chrome.storage?.local) return;

  chrome.storage.local.get(
    [STORAGE_KEYS.profile, STORAGE_KEYS.settings],
    items => {
      if (chrome.runtime.lastError) return;
      applyStored(items);
      startWhenReady();
    }
  );
})();
