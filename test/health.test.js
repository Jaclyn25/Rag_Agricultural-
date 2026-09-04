import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

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

test('health endpoint returns 200 with status ok', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(typeof body.uptime, 'number');
});

test('static frontend is served at /', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /زراعة شات/);
});

test('source view endpoint returns chunks for a known source', async () => {
  const res = await fetch(`${base}/api/knowledge/source/${encodeURIComponent('01_المحاصيل_الزراعية.txt')}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, '01_المحاصيل_الزراعية.txt');
  assert.ok(Array.isArray(body.chunks));
  assert.ok(body.chunks.length > 0);
  assert.equal(typeof body.chunks[0].text, 'string');
});
