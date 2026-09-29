/*
 * Local example profile for PrivSight autofill.
 * Replace these fictional values with your own.
 * This file is read only by the content-side autofill module
 * and is never sent to the agent backend.
 */
(() => {
  'use strict';

  const PII_CONFIG = {
    identity: {
      fullName: 'Alston PR',
      firstName: 'Alston',
      middleName: 'Alston',
      lastName: 'Alston',
      preferredName: 'Rahul',
      dateOfBirth: '2002-07-15',
      gender: 'Male',
      nationality: 'Indian',
    },

    contact: {
      email: 'rahul.sharma@example.com',
      secondaryEmail: 'rahul.test@example.com',
      phone: '+919876543210',
      secondaryPhone: '+919812345678',
      whatsapp: '+919876543210',
    },

    address: {
      addressLine1: '42 Example Residency',
      addressLine2: 'Flat 302',
      apartment: '302',
      street: 'Example Main Road',
      locality: 'Sample Nagar',
      city: 'Bengaluru',
      district: 'Bengaluru Urban',
      state: 'Karnataka',
      country: 'India',
      pinCode: '560001',
      zipCode: '560001',
    },

    government: {
      aadhaar: '000000000000',
      pan: 'ABCDE1234F',
      passportNumber: 'P0000000',
      passportExpiry: '2032-07-15',
      drivingLicence: 'KA00 00000000000',
      voterId: 'ABC0000000',
    },

    financial: {
      bankAccount: '000000000000',
      ifsc: 'TEST0000001',
      bankName: 'Example Bank',
      branch: 'Bengaluru Main Branch',
      upiId: 'rahul.sharma@example',
    },

    education: {
      college: 'Example Institute of Technology',
      university: 'Example University',
      studentId: '24255115090',
      registrationNumber: 'REG20260001',
      course: 'Bachelor of Engineering',
      branch: 'Information Science and Engineering',
      year: '3',
      semester: '5',
      graduationYear: '2028',
    },

    professional: {
      company: 'Example Technologies Pvt Ltd',
      jobTitle: 'Software Engineering Intern',
      department: 'Engineering',
      employeeId: 'EMP20260001',
      workEmail: 'rahul.sharma@company.example',
      workPhone: '+918000000001',
    },

    online: {
      github: 'https://github.com/rahul-example',
      linkedin: 'https://www.linkedin.com/in/rahul-example',
      portfolio: 'https://portfolio.example.com/rahul',
      personalWebsite: 'https://rahul.example.com',
      instagram: '@rahul_example',
      twitter: '@rahul_example',
    },

    other: {
      signature: 'Rahul Sharma',
      bio: 'Software engineering student interested in web development and privacy technology.',
      referralCode: 'REF-TEST-2026',
    },
  };

  Object.defineProperty(globalThis, 'PrivSightPIIConfig', {
    value: PII_CONFIG,
    configurable: true,
    enumerable: false,
    writable: false,
  });
})();
