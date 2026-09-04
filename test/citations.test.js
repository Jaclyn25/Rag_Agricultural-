import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { extractSourceMarkers, validateCitations } from '../utils/citations.js';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeraea-cit-'));
process.env.ZERAEH_DATA_DIR = tmpDir;
process.env.ADMIN_TOKEN = 'test-token';

mock.module('../server/chat.js', {
  namedExports: {
    askQuestion: async () => ({
      stream: (async function* () {
        yield { choices: [{ delta: { content: 'وفق [SOURCE_1] يجب مكافحة الآفات.' } }] };
      })(),
      sources: ['04_مكافحة_الآفات.txt'],
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

after(async () => {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('S13: valid SOURCE markers are recognized', () => {
  const res = validateCitations('انظر [SOURCE_1] و [SOURCE_2]', ['a.txt', 'b.txt']);
  assert.deepEqual(res.valid, [1, 2]);
  assert.deepEqual(res.invalid, []);
});

test('S13: markers referencing nonexistent sources are invalid', () => {
  const res = validateCitations('انظر [SOURCE_3]', ['a.txt', 'b.txt']);
  assert.deepEqual(res.valid, []);
  assert.deepEqual(res.invalid, [3]);
});

test('S13: duplicate markers are deduplicated', () => {
  const res = validateCitations('[SOURCE_1] ثم [SOURCE_1]', ['a.txt']);
  assert.deepEqual(res.valid, [1]);
  assert.deepEqual(res.invalid, []);
});

test('S13: forged old-style filename citations are not accepted as markers', () => {
  const markers = extractSourceMarkers('انظر [المصدر: fake.txt]');
  assert.deepEqual(markers, []);
  const res = validateCitations('انظر [المصدر: fake.txt]', ['a.txt']);
  assert.deepEqual(res.invalid, []);
});

test('S13: answer citations are validated against server-controlled retrieved sources', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'كيف نكافح الآفات؟' }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /04_مكافحة_الآفات\.txt/, 'sources event must be server-controlled');
  assert.doesNotMatch(text, /fake\.txt/, 'forged source must never appear in sources');
});
