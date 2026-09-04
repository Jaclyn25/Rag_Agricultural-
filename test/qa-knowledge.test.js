import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeraea-qa-'));
process.env.ZERAEH_DATA_DIR = tmpDir;
process.env.ADMIN_TOKEN = 'qa-test-token';

const { app } = await import('../server/app.js');
const store = await import('../utils/store.js');

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

const adminPost = (body) => fetch(`${base}/api/knowledge/qa`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'qa-test-token' },
  body: JSON.stringify(body),
});

test('S5: QA save requires admin token', async () => {
  const res = await fetch(`${base}/api/knowledge/qa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'س', answer: 'ج' }),
  });
  assert.equal(res.status, 401);
});

test('S15: unique QA is saved with provenance and becomes retrievable', async () => {
  const q = 'ما هو أفضل سماد للطماطم في التربة الرملية؟';
  const a = 'يُنصح باستخدام سماد نيتروجيني متوازن مع كميات مناسبة من الفوسفور.';
  const res = await adminPost({ question: q, answer: a });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.created, true);
  assert.equal(data.provenance, 'user_qa');
  const qaId = data.id;

  const listed = await (await fetch(`${base}/api/knowledge/qa`, { headers: { 'X-Admin-Token': 'qa-test-token' } })).json();
  const entry = listed.find(e => e.id === qaId);
  assert.equal(entry.sourceType, 'admin_qa');
  assert.equal(entry.provenance, 'user_qa');
  assert.equal(entry.approved, true);

  const vectors = await store.readStore();
  const qaVector = vectors.find(v => (v.tags || []).includes(`qa:${qaId}`));
  assert.ok(qaVector, 'QA must be embedded into the vector store');
  assert.equal(qaVector.category, 'user_qa');
  assert.equal(qaVector.source, 'user_qa');

  const { generateEmbedding } = await import('../utils/embed.js');
  const emb = await generateEmbedding(q);
  const retrieved = await store.searchSimilar(emb, 5, q, 0.7);
  assert.ok(retrieved.some(r => r.source === 'user_qa'), 'matching question must retrieve the QA chunk');
});

test('S15: duplicate QA is not re-added', async () => {
  const q = 'ما هو أفضل سماد للطماطم في التربة الرملية؟';
  const a = 'يُنصح باستخدام سماد نيتروجيني متوازن مع كميات مناسبة من الفوسفور.';
  const res = await adminPost({ question: q, answer: a });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.created, false, 'duplicate must be detected');
});

test('S15: deleting QA removes it from storage and retrieval', async () => {
  const q = 'كيف أعالج اصفرار أوراق الطماطم؟';
  const res = await adminPost({ question: q, answer: 'السبب غالباً نقص النيتروجين. أضف سماداً نيتروجينياً.' });
  const data = await res.json();
  const qaId = data.id;

  const del = await fetch(`${base}/api/knowledge/qa/${qaId}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Token': 'qa-test-token' },
  });
  assert.equal(del.status, 200);

  const vectors = await store.readStore();
  assert.ok(!vectors.some(v => (v.tags || []).includes(`qa:${qaId}`)), 'vector must be removed');

  const listed = await (await fetch(`${base}/api/knowledge/qa`, { headers: { 'X-Admin-Token': 'qa-test-token' } })).json();
  assert.ok(!listed.some(e => e.id === qaId), 'metadata must be removed');
});
