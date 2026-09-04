import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeraea-rl-'));
process.env.ZERAEH_DATA_DIR = tmpDir;
process.env.RATE_LIMIT_MAX = '3';
process.env.RATE_LIMIT_WINDOW_MS = '60000';

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

mock.module('../server/chat.js', {
  namedExports: {
    askQuestion: async () => ({
      stream: (async function* () { yield { choices: [{ delta: { content: 'ok' } }] }; })(),
      sources: [],
      noContext: false,
    }),
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

after(() => {
  server.closeAllConnections?.();
  return new Promise((resolve) => server.close(resolve));
});

test('S2: rate limiter rejects requests beyond the configured max per window', async () => {
  const makeRequest = () => fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'سؤال' }),
  });

  const statuses = [];
  for (let i = 0; i < 4; i++) {
    const res = await makeRequest();
    statuses.push(res.status);
  }

  assert.deepEqual(statuses, [200, 200, 200, 429], '4th request within the window must be rejected');
});
