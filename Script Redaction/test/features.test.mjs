import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

globalThis.DOMParser = new JSDOM('').window.DOMParser;
const { PIIRedactor } = await import('../js/redactor/index.js');
const r = new PIIRedactor();
const reasonsOf = (entities) => entities.flatMap(e => e.reasons).join(' | ');

test('form hints: autocomplete and input types', () => {
  const html = '<form>' +
    '<input autocomplete="shipping family-name" value="Wei">' +
    '<input type="tel" value="4412 3456">' +
    '<input autocomplete="street-address" value="House 9, Near Old Temple">' +
    '<input type="password" value="hunter22">' +
    '<textarea autocomplete="email">someone at example dot com</textarea>' +
    '<input name="coupon" value="SAVE20"><input type="submit" value="Send"></form>';
  const { output, entities } = r.analyzeHTML(html);
  for (const leaked of ['"Wei"', '4412 3456', 'House 9', 'hunter22', 'someone at example']) {
    assert.ok(!output.includes(leaked), `${leaked} should be redacted: ${output}`);
  }
  assert.ok(output.includes('SAVE20') && output.includes('value="Send"'));
  assert.match(reasonsOf(entities), /autocomplete="family-name"/);
  assert.match(reasonsOf(entities), /input type="password"/);
});

test('column inference: HTML table without useful headers', () => {
  const rows = [['Priya Nair', '98450 12345'], ['Rahul Verma', '97401 55667'], ['Ananya Iyer', '080-2345 6789'],
    ['Chen Wei', '91234 56780'], ['Farhan Khan', '4412 3456']];
  const html = `<table><thead><tr><th>Col A</th><th>Col B</th></tr></thead><tbody>${
    rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody></table>`;
  const { output, entities } = r.analyzeHTML(html);
  assert.ok(!output.includes('Chen Wei'), 'name column should cover names outside the gazetteer');
  assert.ok(!output.includes('4412 3456'), 'phone column should cover the odd-format number');
  assert.match(reasonsOf(entities), /column inference: 4\/5 cells are NAME/);
  assert.ok(output.includes('Col A'));
});

test('column inference: product table is left alone', () => {
  const html = '<table><tr><th>Item</th><th>Price</th></tr><tr><td>Pen</td><td>10</td></tr>' +
    '<tr><td>Notebook</td><td>45</td></tr><tr><td>Stapler</td><td>120</td></tr></table>';
  const { entities } = r.analyzeHTML(html);
  assert.equal(entities.length, 0);
});

test('column inference: CSV text', () => {
  const csv = 'member,contact,plan\nPriya Nair,9845012345,Gold\nRahul Verma,9740155667,Silver\n' +
    'Chen Wei,9123456780,Gold\nAnanya Iyer,9988776655,Basic';
  const { output } = r.analyzeText(csv);
  assert.ok(!output.includes('Chen Wei'), output);
  assert.ok(output.includes('Gold') && output.includes('member,contact,plan'), output);
});

test('column inference: prose with commas is not treated as a table', () => {
  const text = 'Yes, fine, thanks for asking\nOk, see you, bye for now\nSure, noted, will do';
  assert.equal(r.analyzeText(text).output, text);
});

test('allow and deny lists', () => {
  const text = 'Contact Ravi Kumar at the Sharma Traders desk. Employee code EMP-00931 approved by Priya Nair.';
  const { output, entities } = r.analyzeText(text, {
    allow: ['Ravi Kumar'],
    deny: [{ value: /EMP-\d{5}/, type: 'EMPLOYEE_ID' }],
  });
  assert.ok(output.includes('Ravi Kumar'), output);
  assert.ok(output.includes('[REDACTED_EMPLOYEE_ID]'), output);
  assert.ok(!output.includes('Priya Nair'), output);
  assert.match(reasonsOf(entities), /deny list \/EMP-\\d\{5\}\//);
  // Deny wins over allow
  assert.ok(!r.analyzeText('code EMP-00931', { allow: ['EMP-00931'], deny: [/EMP-\d{5}/] }).output.includes('EMP-00931'));
});

test('entropy: unknown secrets are caught, look-alikes are not', () => {
  const secret = r.analyzeText('export PAYMENT_TOKEN=Zx9Qm2LpT7vRk4Wn8YbC1dFh');
  assert.ok(!secret.output.includes('Zx9Qm2LpT7vRk4Wn8YbC1dFh'), secret.output);
  assert.match(reasonsOf(secret.entities), /high-entropy token/);

  const safe = [
    'commit 9fceb02d0ae598e95dc970b74dcfe8e5fcba6af3 merged',
    'request 550e8400-e29b-41d4-a716-446655440000 done',
    'see https://cdn.example.com/assets/Ab3dE5fG7hJ9kL1mN3pQ5r.png',
    'class configurationManagerFactoryImpl extends Base',
    'UTR ICICR52024030500012345 credited',
  ];
  for (const t of safe) assert.equal(r.analyzeText(t).output, t);
});

test('explanations: every entity says why', () => {
  const { entities } = r.analyzeText('Aadhaar 2345 6781 2346, Order ID 9876543210');
  const aadhaar = entities.find(e => e.type === 'AADHAAR');
  assert.ok(aadhaar.reasons.includes('Verhoeff checksum passed'), aadhaar.reasons.join(' | '));
  assert.ok(aadhaar.reasons.some(x => /context 'aadhaar'/.test(x)));
  assert.ok(entities.every(e => e.reasons.length > 0));
});
