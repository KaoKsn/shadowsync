/*
 * Autofill profile schema for PrivSight.
 *
 * This file only describes WHICH fields exist. The user's actual values are
 * stored in chrome.storage.local (edited on profile/profile.html), so no
 * personal data lives in source code or git. That stored profile is the
 * single source of truth for both autofill (pii-autofill.js) and profile
 * redaction (agent.js -> redactor.js). Users may add custom keys beyond the
 * built-in fields; both paths pick them up without code changes.
 * Never sent to the agent backend.
 */
(() => {
  'use strict';

  // [key, label, inputType]. Keys must match FIELD_MAPPINGS in pii-autofill.js.
  const GROUPS = [
    {
      id: 'identity',
      title: 'Identity',
      fields: [
        ['fullName', 'Full name'],
        ['firstName', 'First name'],
        ['middleName', 'Middle name'],
        ['lastName', 'Last name'],
        ['preferredName', 'Preferred name'],
        ['dateOfBirth', 'Date of birth', 'date'],
        ['gender', 'Gender'],
        ['nationality', 'Nationality'],
      ],
    },
    {
      id: 'contact',
      title: 'Contact',
      fields: [
        ['email', 'Email', 'email'],
        ['secondaryEmail', 'Secondary email', 'email'],
        ['phone', 'Phone', 'tel'],
        ['secondaryPhone', 'Secondary phone', 'tel'],
        ['whatsapp', 'WhatsApp', 'tel'],
      ],
    },
    {
      id: 'address',
      title: 'Address',
      fields: [
        ['addressLine1', 'Address line 1'],
        ['addressLine2', 'Address line 2'],
        ['apartment', 'Apartment / unit'],
        ['street', 'Street'],
        ['locality', 'Locality / district'],
        ['city', 'City'],
        ['state', 'State'],
        ['country', 'Country'],
        ['pinCode', 'PIN / postal code'],
      ],
    },
    {
      id: 'government',
      title: 'Government IDs',
      sensitive: true,
      fields: [
        ['aadhaar', 'Aadhaar number'],
        ['pan', 'PAN'],
        ['passportNumber', 'Passport number'],
        ['passportExpiry', 'Passport expiry', 'date'],
        ['drivingLicence', 'Driving licence'],
        ['voterId', 'Voter ID'],
      ],
    },
    {
      id: 'financial',
      title: 'Bank & payments',
      sensitive: true,
      fields: [
        ['bankAccount', 'Bank account number'],
        ['ifsc', 'IFSC'],
        ['bankName', 'Bank name'],
        ['branch', 'Bank branch'],
        ['upiId', 'UPI ID'],
      ],
    },
    {
      id: 'education',
      title: 'Education',
      fields: [
        ['college', 'College / university'],
        ['studentId', 'Student ID / USN'],
        ['registrationNumber', 'Registration number'],
        ['course', 'Course'],
        ['educationBranch', 'Branch / stream'],
        ['year', 'Year of study'],
        ['semester', 'Semester'],
        ['graduationYear', 'Graduation year'],
      ],
    },
    {
      id: 'professional',
      title: 'Work',
      fields: [
        ['company', 'Company'],
        ['jobTitle', 'Job title'],
        ['department', 'Department'],
        ['employeeId', 'Employee ID'],
        ['workEmail', 'Work email', 'email'],
        ['workPhone', 'Work phone', 'tel'],
      ],
    },
    {
      id: 'online',
      title: 'Online',
      fields: [
        ['github', 'GitHub', 'url'],
        ['linkedin', 'LinkedIn', 'url'],
        ['portfolio', 'Portfolio', 'url'],
        ['personalWebsite', 'Personal website', 'url'],
        ['instagram', 'Instagram'],
        ['twitter', 'X / Twitter'],
      ],
    },
    {
      id: 'other',
      title: 'Other',
      fields: [
        ['bio', 'Short bio', 'textarea'],
        ['referralCode', 'Referral code'],
      ],
    },
  ];

  // Government IDs and bank details are only filled on sites the user allows.
  const SENSITIVE_KEYS = GROUPS
    .filter((group) => group.sensitive)
    .flatMap((group) => group.fields.map(([key]) => key));

  // The same stored profile drives redaction: every profile value is masked
  // wherever it appears on a page before page data leaves the browser. These
  // keys hold generic values ("India", "Male", "3") that would blank out
  // ordinary page text and break navigation, so they are autofill-only.
  const REDACT_EXEMPT_KEYS = [
    'gender', 'nationality', 'city', 'state', 'country',
    'bankName', 'course', 'educationBranch', 'year', 'semester',
    'graduationYear', 'department', 'jobTitle', 'passportExpiry',
  ];

  // Keys holding a person's name. Their individual words are masked too, so
  // "Hi John" is caught when the profile holds "John Doe".
  const NAME_KEYS = ['fullName', 'firstName', 'middleName', 'lastName', 'preferredName'];

  const SCHEMA_KEYS = new Set(GROUPS.flatMap((group) => group.fields.map(([key]) => key)));

  /** "studentId" / "library_card-no" -> "student id" / "library card no" */
  function keyToLabel(key) {
    return String(key || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_\-.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  Object.defineProperty(globalThis, 'PrivSightPIISchema', {
    value: Object.freeze({
      groups: GROUPS,
      sensitiveKeys: SENSITIVE_KEYS,
      redactExemptKeys: REDACT_EXEMPT_KEYS,
      nameKeys: NAME_KEYS,
      // Keys the user adds on the profile page beyond the built-in fields
      isCustomKey: (key) => !SCHEMA_KEYS.has(key),
      // Built-in name fields, plus custom keys that hold a person's name
      // ("name", "studentName", "nick name") — not "username" or "bankName"
      isNameKey: (key) => NAME_KEYS.includes(key) ||
        (!SCHEMA_KEYS.has(key) &&
          /^(?:(?:full|first|middle|last|given|family|preferred|nick|legal|student|my)\s?)?name$/
            .test(keyToLabel(key))),
      keyToLabel,
      storageKeys: {
        profile: 'privsightProfile',            // { [fieldKey]: string }
        settings: 'privsightAutofillSettings',  // { enabled, sensitiveSites: [origin] }
        guard: 'privsightPiiGuard',             // { enabled } text-box PII warning (pii-guard.js)
      },
      defaultSettings: { enabled: true, sensitiveSites: [] },
    }),
    configurable: true,
    enumerable: false,
    writable: false,
  });
})();
