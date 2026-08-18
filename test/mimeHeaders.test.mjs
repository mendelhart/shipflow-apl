/**
 * .eml headers. The app's own default APL subject contains an en dash and the
 * exporter address contains "Michèle-Bohec", both of which were written raw
 * into headers declared 7bit.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');

const { encodeHeader, encodeAddressHeader, encodeTextBody } = await import('../src/lib/mimeHeaders.js');

test('plain ASCII headers are left exactly as they were', () => {
  assert.equal(encodeHeader('Shipping documents for PO 50 813584'), 'Shipping documents for PO 50 813584');
  assert.equal(encodeTextBody('hello\nworld').encoding, '7bit');
});

test('a non-ASCII subject is RFC 2047 encoded', () => {
  const out = encodeHeader('Documents – PO 50 813584'); // en dash
  assert.match(out, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
  assert.equal(Buffer.from(out.slice(10, -2), 'base64').toString('utf8'), 'Documents – PO 50 813584');
});

test('only the display name of an address is encoded, never the address itself', () => {
  const out = encodeAddressHeader('Capital Nutrition Québec <docs@capitalnutrition.ca>');
  assert.match(out, /^=\?UTF-8\?B\?.+\?= <docs@capitalnutrition\.ca>$/);
  assert.equal(encodeAddressHeader('docs@capitalnutrition.ca'), 'docs@capitalnutrition.ca');
});

test('a non-ASCII body is base64, not declared 7bit', () => {
  const { encoding, body } = encodeTextBody('1020 Boul. Michèle-Bohec\nBlainville');
  assert.equal(encoding, 'base64');
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8'), '1020 Boul. Michèle-Bohec\r\nBlainville');
});

test('base64 bodies wrap at 76 characters as MIME requires', () => {
  const { body } = encodeTextBody('é'.repeat(500));
  assert.ok(body.split('\r\n').every((l) => l.length <= 76));
});

test('a newline in a header cannot start a second header', () => {
  // Subjects are built from LLM-extracted PO numbers; a stray CRLF would end
  // the Subject header and let the rest be read as Bcc:.
  const out = encodeHeader('PO 813584\r\nBcc: attacker@example.com');
  assert.ok(!/[\r\n]/.test(out));
  assert.equal(out, 'PO 813584 Bcc: attacker@example.com');
});

test('newlines and tabs do not force a plain-text body into base64', () => {
  assert.equal(encodeTextBody('line one\nline two\tindented').encoding, '7bit');
});
