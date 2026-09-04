import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArabic, tokenize } from '../utils/text.js';

test('S14: alef variants normalize to bare alef', () => {
  assert.equal(normalizeArabic('إنتاج'), 'انتاج');
  assert.equal(normalizeArabic('إدارة'), 'ادارة');
  assert.equal(normalizeArabic('آبار'), 'ابار');
  assert.deepEqual(tokenize('إنتاج'), tokenize('انتاج'));
});

test('S14: ta marbuta is NOT normalized to ha (conservative scope)', () => {
  assert.notEqual(normalizeArabic('إدارة'), normalizeArabic('اداره'), 'ة→ه must not be applied');
  assert.notDeepEqual(tokenize('إدارة'), tokenize('اداره'));
});

test('S14: alef maqsura normalizes to ya', () => {
  assert.equal(normalizeArabic('على'), 'علي');
  assert.equal(normalizeArabic('مستشفى'), 'مستشفي');
  assert.deepEqual(tokenize('على'), tokenize('علي'));
});

test('S14: diacritics are removed', () => {
  assert.equal(normalizeArabic('مُحَاصِيل'), 'محاصيل');
  assert.equal(normalizeArabic('زِرَاعَة'), 'زراعة');
});

test('S14: tatweel is removed', () => {
  assert.equal(normalizeArabic('محاصيــل'), 'محاصيل');
  assert.equal(normalizeArabic('زراعــة'), 'زراعة');
});

test('S14: tokenizer treats alef-variant agricultural terms as identical', () => {
  assert.deepEqual(tokenize('ما هي انواع التربة الزراعية؟'), tokenize('ما هي أنواع التربة الزراعية؟'));
  assert.deepEqual(tokenize('انواع التربة'), tokenize('أنواع التربة'));
  assert.deepEqual(tokenize('انتاج التمور'), tokenize('إنتاج التمور'));
});

test('S14: tokenizer keeps ta-marbuta variants distinct (no aggressive merge)', () => {
  assert.notDeepEqual(tokenize('التربه'), tokenize('التربة'));
  assert.notDeepEqual(tokenize('ما هي انواع التربه الزراعيه؟'), tokenize('ما هي أنواع التربة الزراعية؟'));
});
