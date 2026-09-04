import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeraea-conv-'));
process.env.ZERAEH_DATA_DIR = tmpDir;

const { app } = await import('../server/app.js');
const conversations = await import('../utils/conversations.js');

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

function makeConv(id, title = 'محادثة') {
  return {
    id,
    title,
    messages: [{ role: 'user', content: 'سؤال' }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const postConv = (conv) => fetch(`${base}/api/conversations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(conv),
});

test('GROUP0: new conversation gets a server write token', async () => {
  const res = await postConv(makeConv('conv-new-1'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.writeToken, 'string');
  assert.ok(body.writeToken.length >= 16);
});

test('GROUP0: updating an existing conversation without write token is rejected (403)', async () => {
  const res = await postConv(makeConv('conv-locked-1'));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.ok(body.writeToken);

  const attempt = await postConv({
    ...makeConv('conv-locked-1', 'محاولة سرقة'),
    messages: [{ role: 'user', content: 'محتوى مزور' }],
  });
  assert.equal(attempt.status, 403, 'overwrite without token must fail');
});

test('GROUP0: updating with the wrong write token is rejected (403)', async () => {
  const res = await postConv(makeConv('conv-wrong-token'));
  assert.equal(res.status, 200);

  const attempt = await postConv({
    ...makeConv('conv-wrong-token'),
    writeToken: 'definitely-wrong-token',
  });
  assert.equal(attempt.status, 403);
});

test('GROUP0: updating with the correct write token succeeds', async () => {
  const res = await postConv(makeConv('conv-update-ok'));
  const body = await res.json();
  assert.equal(res.status, 200);

  const updated = makeConv('conv-update-ok', 'عنوان محدث');
  updated.messages.push({ role: 'assistant', content: 'جواب' });
  updated.writeToken = body.writeToken;

  const res2 = await postConv(updated);
  assert.equal(res2.status, 200);

  const stored = await conversations.getConversation('conv-update-ok');
  assert.equal(stored.title, 'عنوان محدث');
  assert.equal(stored.messages.length, 2);
});

test('GROUP0: one arbitrary request cannot overwrite an unrelated existing conversation', async () => {
  const resA = await postConv(makeConv('conv-victim'));
  const bodyA = await resA.json();
  assert.equal(resA.status, 200);

  const attackerConv = makeConv('conv-attacker', 'محادثة المهاجم');
  attackerConv.messages = [{ role: 'user', content: 'أنا لست المالك' }];
  await postConv(attackerConv);

  const attack = await postConv({
    ...makeConv('conv-victim', 'انتحال'),
    messages: [{ role: 'user', content: 'محتوى منتحل' }],
  });
  assert.equal(attack.status, 403);

  const victim = await conversations.getConversation('conv-victim');
  assert.equal(victim.title, 'محادثة');
  assert.equal(victim.messages[0].content, 'سؤال');
  assert.equal(bodyA.writeToken, victim.writeToken, 'victim write token must remain unchanged');
});
