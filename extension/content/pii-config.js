/*
 * Autofill profile schema for PrivSight.
 *
 * This file only describes WHICH fields exist. The user's actual values are
 * stored in chrome.storage.local (edited on profile/profile.html), so no
 * personal data lives in source code or git. Shared by the content-side
 * autofill module and the profile page. Never sent to the agent backend.
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

  Object.defineProperty(globalThis, 'PrivSightPIISchema', {
    value: Object.freeze({
      groups: GROUPS,
      sensitiveKeys: SENSITIVE_KEYS,
      storageKeys: {
        profile: 'privsightProfile',            // { [fieldKey]: string }
        settings: 'privsightAutofillSettings',  // { enabled, sensitiveSites: [origin] }
      },
      defaultSettings: { enabled: true, sensitiveSites: [] },
    }),
    configurable: true,
    enumerable: false,
    writable: false,
  });
})();
