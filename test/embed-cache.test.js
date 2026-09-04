import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCacheKey } from '../utils/embed.js';

test('S18: cache key is deterministic for identical text + model', () => {
  const a = buildCacheKey('ما هي التربة الزراعية؟');
  const b = buildCacheKey('ما هي التربة الزراعية؟');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/, 'key must be a SHA-256 hex digest');
});

test('S18: cache key includes embedding model identity', () => {
  const withModelA = buildCacheKey('same text', 'model-a');
  const withModelB = buildCacheKey('same text', 'model-b');
  assert.notEqual(withModelA, withModelB, 'different models must never share cache entries');
});

test('S18: cache key has no prefix/length collision for distinct texts', () => {
  const prefix = 'x'.repeat(100);
  const text1 = `${prefix}A`;
  const text2 = `${prefix}B`;
  assert.equal(text1.length, text2.length, 'same length precondition');
  assert.notEqual(buildCacheKey(text1), buildCacheKey(text2), 'distinct texts with equal prefix/length must not collide');
});
