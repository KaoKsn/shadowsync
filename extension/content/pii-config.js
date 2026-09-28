/*
 * Local example profile for PrivSight autofill.
 * Replace these clearly fictional values with your own. This file is read only
 * by the content-side autofill module and is never sent to the agent backend.
 */
(() => {
  'use strict';

  const PII_CONFIG = {
    identity: {
      fullName: 'Example User', firstName: 'Example', middleName: '', lastName: 'User',
      preferredName: 'Example', dateOfBirth: '2000-01-31', gender: '', nationality: 'Indian',
    },
    contact: {
      email: 'user@example.com', secondaryEmail: '', phone: '+910000000000',
      secondaryPhone: '', whatsapp: '',
    },
    address: {
      addressLine1: '123 Example Street', addressLine2: '', apartment: '', street: 'Example Street',
      locality: '', city: 'Example City', district: '', state: 'Example State', country: 'India',
      pinCode: '000000', zipCode: '000000',
    },
    government: {
      aadhaar: '', pan: '', passportNumber: '', passportExpiry: '', drivingLicence: '', voterId: '',
    },
    financial: { bankAccount: '', ifsc: '', bankName: '', branch: '', upiId: '' },
    education: {
      college: 'Example College', university: '', studentId: '', registrationNumber: '',
      course: 'Example Course', branch: '', semester: '', graduationYear: '',
    },
    professional: {
      company: '', jobTitle: '', department: '', employeeId: '', workEmail: '', workPhone: '',
    },
    online: {
      github: '', linkedin: '', portfolio: '', personalWebsite: '', instagram: '', twitter: '',
    },
    other: { signature: '', bio: '', referralCode: '' },
  };

  // Deliberately expose only the profile object to the sibling content module.
  Object.defineProperty(globalThis, 'PrivSightPIIConfig', {
    value: PII_CONFIG, configurable: true, enumerable: false, writable: false,
  });
})();
