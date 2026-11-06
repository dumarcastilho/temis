import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskCnj } from '../public/cnj-mask.js';

test('formats CNJ progressively and preserves leading zeros', () => {
  for (const [input, expected] of [
    ['', ''], ['0000001', '0000001'], ['00000012', '0000001-2'],
    ['0000001232', '0000001-23.2'], ['00000012320998', '0000001-23.2099.8'],
    ['00000012320998119999', '0000001-23.2099.8.11.9999'],
  ]) assert.equal(maskCnj(input), expected);
  assert.equal(maskCnj('0000001-23.2099.8.11.9999'), '0000001-23.2099.8.11.9999');
  assert.equal(maskCnj('000000123209981199991234'), '0000001-23.2099.8.11.9999');
});
