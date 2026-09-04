import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '../utils/context.js';

test('S26: context respects character budget and preserves rank order', () => {
  const big = 'ز'.repeat(5000);
  const results = [
    { source: 'a.txt', text: big },
    { source: 'b.txt', text: big },
    { source: 'c.txt', text: big },
  ];
  const built = buildContext(results, 8000);
  assert.ok(built.blockCount >= 1 && built.blockCount <= 2, 'budget must stop adding blocks');
  assert.ok(built.charCount <= 8000);
  assert.equal(built.blockCount, 1, 'second block (5000+5000=10000) must not fit in 8000');
});

test('S26: identical chunk text is deduplicated', () => {
  const results = [
    { source: 'a.txt', text: 'نص متطابق تماماً' },
    { source: 'b.txt', text: 'نص متطابق تماماً' },
    { source: 'c.txt', text: 'نص مختلف' },
  ];
  const built = buildContext(results, 12000);
  assert.equal(built.blockCount, 2, 'duplicate text must be collapsed');
  assert.deepEqual(built.usedSources, ['a.txt', 'c.txt']);
});

test('S26: no cap and no dups preserves all chunks (production-like)', () => {
  const results = Array.from({ length: 10 }, (_, i) => ({ source: `doc${i}.txt`, text: `مقطع رقم ${i}` }));
  const built = buildContext(results, 12000);
  assert.equal(built.blockCount, 10);
  assert.equal(built.usedSources.length, 10);
  assert.ok(built.text.startsWith('<retrieved_context>'));
});
