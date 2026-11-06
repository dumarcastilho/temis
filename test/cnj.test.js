import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNumber, tribunalFor, formatNumber } from '../src/cnj.js';

// Synthetic identifiers: valid check digits do not imply an existing case.
export function syntheticNumber(court = '11', serial = '9999999') {
  const suffix = `20998${court}9999`;
  let remainder = 0;
  for (const digit of serial + suffix + '00') remainder = (remainder * 10 + Number(digit)) % 97;
  return serial + String(98 - remainder).padStart(2,'0') + suffix;
}
test('CNJ validation and format preserve leading zeros', () => {
  const n = syntheticNumber('11','0000001');
  assert.equal(normalizeNumber(formatNumber(n)),n);
  assert.equal(tribunalFor(n),'tjmt');
});
test('rejects wrong check digits, arbitrary input and malformed numbers', () => {
  const n = syntheticNumber();
  for(const value of [null, '', n.slice(1), n + '0', 'processo ' + n, n.slice(0,7)+'00'+n.slice(9)]) assert.throws(()=>normalizeNumber(value));
});
test('initial state courts are mapped by CNJ code', () => {
  for(const [code,name] of [['09','tjgo'],['11','tjmt'],['20','tjrn'],['05','tjba'],['17','tjpe']]) assert.equal(tribunalFor(syntheticNumber(code)),name);
});
