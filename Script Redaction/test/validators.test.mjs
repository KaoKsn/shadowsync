import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as v from '../js/redactor/validators.js';

test('verhoeff / aadhaar', () => {
  assert.equal(v.verhoeff('2363'), true);
  assert.equal(v.verhoeffCheckDigit('236'), 3);
  for (const a of ['2345 6781 2346', '4987 1203 4560', '7890-1234-5674', '564321098763']) {
    assert.equal(v.isAadhaar(a), true, a);
  }
  for (const a of ['2345 6781 2347', '1234 5678 9012', '0987 1203 4560', '2222 2222 2222', '23456781234']) {
    assert.equal(v.isAadhaar(a), false, a);
  }
  assert.equal(v.isAadhaarVID('9123 4567 8901 2346'), true);
  assert.equal(v.isAadhaarVID('9123 4567 8901 2345'), false);
});

test('luhn / cards / imei', () => {
  assert.equal(v.isCreditCard('4111 1111 1111 1111'), true);
  assert.equal(v.isCreditCard('6080 0123 4567 8903'), true); // RuPay
  assert.equal(v.isCreditCard('3782 822463 10005'), true); // Amex
  assert.equal(v.isCreditCard('4111 1111 1111 1112'), false);
  assert.equal(v.isCreditCard('9876 5432 1012 3456'), false); // unknown IIN
  assert.equal(v.isIMEI('352099001761481'), true);
  assert.equal(v.isIMEI('352099001761482'), false);
});

test('PAN / GSTIN / IFSC', () => {
  assert.equal(v.isPAN('ABCPS1234K'), true);
  assert.equal(v.isPAN('ABCXS1234K'), false); // invalid holder type
  assert.equal(v.isGSTIN('27AAPFU0939F1ZV'), true);
  assert.equal(v.isGSTIN('29ABCPK1234F1Z1'), true);
  assert.equal(v.isGSTIN('29ABCPK1234F1Z2'), false); // bad check char
  assert.equal(v.isGSTIN('45ABCPK1234F1Z1'), false); // bad state code
  assert.equal(v.isIFSC('HDFC0001234'), true);
  assert.equal(v.isIFSC('HDFC1001234'), false); // 5th char must be 0
});

test('indian mobile / UPI / pincode', () => {
  for (const p of ['9812345670', '+91 98765 43210', '+91-8123456789', '07896 543210']) {
    assert.equal(v.isIndianMobile(p), true, p);
  }
  for (const p of ['5812345670', '9999999999', '98123']) assert.equal(v.isIndianMobile(p), false, p);
  assert.equal(v.isUPI('rahul.verma@okhdfcbank'), true);
  assert.equal(v.isUPI('meera@ybl'), true);
  assert.equal(v.isUPI('meera@gmail.com'), false);
  assert.equal(v.isUPI('meera@unknownhandle'), false);
  assert.equal(v.isIndianPincode('560038'), true);
  assert.equal(v.isIndianPincode('060038'), false);
});

test('ipv4 / jwt / dates', () => {
  assert.equal(v.isIPv4('203.0.113.45'), true);
  assert.equal(v.isIPv4('256.1.1.1'), false);
  assert.equal(v.isIPv4('01.2.3.4'), false);
  assert.equal(v.isJWT('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig'), true);
  assert.equal(v.isJWT('eyJmb28iOiJiYXIifQ.eyJzdWIiOiIxIn0.sig'), false); // no alg
  for (const d of ['04/11/1992', '1990-07-21', '21-09-1985', '15 August 1988', 'March 12, 1990', '12/31/1999']) {
    assert.equal(v.isDate(d), true, d);
  }
  for (const d of ['31/02/1990', '2024.13.01', '45/45/2020', 'Foo 12, 1990']) assert.equal(v.isDate(d), false, d);
});
