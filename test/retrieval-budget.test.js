import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { applyRetrievalBudget, STRATEGY_COST, DEFAULT_MAX_BUDGET } from '../utils/retrieval-budget.js';

test('S7: all flags on are capped to budget (multiHop 2 + hyde 1 = 3)', () => {
  const res = applyRetrievalBudget({ useHyde: true, useExpansion: true, useMultiHop: true, useWebFallback: true });
  assert.equal(res.budgetUsed, 3);
  assert.deepEqual(res.strategiesRun, ['useMultiHop', 'useHyde']);
  assert.equal(res.useExpansion, false);
  assert.equal(res.useWebFallback, false);
});

test('S7: light combinations are preserved', () => {
  const res = applyRetrievalBudget({ useHyde: true, useExpansion: true });
  assert.deepEqual(res.strategiesRun, ['useHyde', 'useExpansion']);
  assert.equal(res.budgetUsed, 2);
});

test('S7: multiHop + expansion fit within budget, web fallback dropped', () => {
  const res = applyRetrievalBudget({ useMultiHop: true, useExpansion: true, useWebFallback: true });
  assert.deepEqual(res.strategiesRun, ['useMultiHop', 'useExpansion']);
  assert.equal(res.useWebFallback, false);
});

test('S7: no flags means no strategies', () => {
  const res = applyRetrievalBudget({});
  assert.deepEqual(res.strategiesRun, []);
  assert.equal(res.budgetUsed, 0);
});

test('S7: default budget and costs are sane', () => {
  assert.equal(DEFAULT_MAX_BUDGET, 3);
  assert.equal(STRATEGY_COST.useMultiHop, 2);
  assert.equal(STRATEGY_COST.useHyde, 1);
});

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeraea-budget-'));
process.env.ZERAEH_DATA_DIR = tmpDir;

let captured = null;
mock.module('../server/chat.js', {
  namedExports: {
    askQuestion: async (question, history, options) => {
      captured = options;
      return {
        stream: (async function* () { yield { choices: [{ delta: { content: 'جواب' } }] }; })(),
        sources: ['a.txt'],
        noContext: false,
      };
    },
  },
});

const { app } = await import('../server/app.js');

let server;
let base;

before(() => new Promise((resolve) => {
  server = app.listen(0, () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('S7: all-flags-on request cannot exceed the strategy budget at the route level', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: 'سؤال',
      useHyde: true,
      useExpansion: true,
      useMultiHop: true,
      useWebFallback: true,
    }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();

  assert.equal(captured.useMultiHop, true);
  assert.equal(captured.useHyde, true);
  assert.equal(captured.useExpansion, false, 'must be capped server-side');
  assert.equal(captured.useWebFallback, false, 'must be capped server-side');
  assert.match(text, /strategiesRun/);
});
