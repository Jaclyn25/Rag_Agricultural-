import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeraea-sec-'));
process.env.ZERAEH_DATA_DIR = tmpDir;
process.env.ADMIN_TOKEN = 'test-admin-token-123';

let lastOptions = null;
const behavior = { type: 'ok' };

mock.module('../server/chat.js', {
  namedExports: {
    askQuestion: async (question, history, options) => {
      lastOptions = options;
      if (behavior.type === 'errorAfterStream') {
        return {
          stream: (async function* () {
            yield { choices: [{ delta: { content: 'بداية' } }] };
            throw new Error('provider boom');
          })(),
          sources: [],
          noContext: false,
        };
      }
      if (behavior.type === 'slow') {
        return {
          stream: (async function* () {
            while (true) {
              yield { choices: [{ delta: { content: 'x' } }] };
              await new Promise(r => setTimeout(r, 50));
            }
          })(),
          sources: ['s.txt'],
          noContext: false,
        };
      }
      return {
        stream: (async function* () { yield { choices: [{ delta: { content: 'جواب' } }] }; })(),
        sources: ['s.txt'],
        noContext: false,
      };
    },
  },
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
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

after(() => {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(resolve));
});

test('S1: protected routes reject missing token with 401', async () => {
  const res = await fetch(`${base}/api/conversations`);
  assert.equal(res.status, 401);
});

test('S1: protected routes reject wrong token with 401', async () => {
  const res = await fetch(`${base}/api/conversations`, {
    headers: { 'X-Admin-Token': 'wrong-token' },
  });
  assert.equal(res.status, 401);
});

test('S1: protected routes accept correct token', async () => {
  const res = await fetch(`${base}/api/conversations`, {
    headers: { 'X-Admin-Token': 'test-admin-token-123' },
  });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(await res.json()));
});

test('S1: feedback is public but validates rating', async () => {
  const noToken = await fetch(`${base}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: 'c1', messageIndex: 0, rating: 1 }),
  });
  assert.equal(noToken.status, 200, 'feedback must be accepted without admin token');

  const badRating = await fetch(`${base}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: 'c1', messageIndex: 0, rating: 5 }),
  });
  assert.equal(badRating.status, 400);

  const missingConv = await fetch(`${base}/api/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messageIndex: 0, rating: 1 }),
  });
  assert.equal(missingConv.status, 400);
});

test('S1: admin verify rejects missing/wrong token and accepts correct token', async () => {
  const missing = await fetch(`${base}/api/admin/verify`);
  assert.equal(missing.status, 401);

  const wrong = await fetch(`${base}/api/admin/verify`, {
    headers: { 'X-Admin-Token': 'wrong-token' },
  });
  assert.equal(wrong.status, 401);

  const ok = await fetch(`${base}/api/admin/verify`, {
    headers: { 'X-Admin-Token': 'test-admin-token-123' },
  });
  assert.equal(ok.status, 200);
});

test('S9: disallowed origin gets no CORS headers', async () => {
  const res = await fetch(`${base}/api/health`, { headers: { Origin: 'http://evil.example' } });
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('S9: local origin is allowed', async () => {
  const res = await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:3000' } });
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:3000');
});

test('S10: security headers present, X-Powered-By disabled', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('S12: oversized question rejected with 400', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'س'.repeat(4001) }),
  });
  assert.equal(res.status, 400);
});

test('S12: arbitrary model rejected with 400', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'سؤال', model: 'gpt-4o' }),
  });
  assert.equal(res.status, 400);
});

test('S12: oversized conversation rejected with 400', async () => {
  const messages = Array.from({ length: 501 }, (_, i) => ({ role: 'user', content: `m${i}` }));
  const res = await fetch(`${base}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'c-big', title: 't', messages, createdAt: 1, updatedAt: 1 }),
  });
  assert.equal(res.status, 400);
});

test('S3: provider failure after streaming started does not crash server', async () => {
  behavior.type = 'errorAfterStream';
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'سؤال' }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /بداية/);

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200, 'server must remain usable after mid-stream provider failure');
});

test('S8: client disconnect aborts upstream and server stays usable', async () => {
  behavior.type = 'slow';
  const ac = new AbortController();
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'سؤال' }),
    signal: ac.signal,
  });
  const reader = res.body.getReader();
  await reader.read();
  ac.abort();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch { /* connection aborted */ }

  await new Promise(r => setTimeout(r, 200));
  assert.equal(lastOptions.signal.aborted, true, 'route should abort the upstream signal on disconnect');

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200, 'server must remain usable after client abort');
});
