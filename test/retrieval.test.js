import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchSimilar, readStore } from '../utils/store.js';

test('retrieval: deterministic query returns stable source shape', async () => {
  const store = await readStore();
  assert.ok(store.length > 0, 'vector store should not be empty');

  const q = new Array(384).fill(0);
  q[0] = 1;

  const r1 = await searchSimilar(q, 10, 'التربة', 0.7);
  const r2 = await searchSimilar(q, 10, 'التربة', 0.7);

  assert.ok(Array.isArray(r1));
  assert.ok(r1.length > 0 && r1.length <= 10);

  for (const entry of r1) {
    assert.equal(typeof entry.source, 'string');
    assert.ok(entry.source.length > 0);
    assert.equal(entry.embedding.length, 384);
    assert.ok(Number.isFinite(entry.score), 'score must be finite');
    assert.ok(Number.isFinite(entry.denseScore), 'denseScore must be finite');
  }

  assert.deepEqual(r1.map(e => e.source), r2.map(e => e.source));
});
