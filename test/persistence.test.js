import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

let tmpDir;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeraea-test-'));
  process.env.ZERAEH_DATA_DIR = tmpDir;
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.ZERAEH_DATA_DIR;
});

test('conversation JSON persistence: basic save/read', async () => {
  const conv = await import('../utils/conversations.js');
  const id = 'conv-test-1';
  await conv.saveConversation({
    id,
    title: 'اختبار المحادثة',
    messages: [
      { role: 'user', content: 'سؤال' },
      { role: 'assistant', content: 'جواب', sources: ['a.txt'] },
    ],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  const got = await conv.getConversation(id);
  assert.equal(got.title, 'اختبار المحادثة');
  assert.equal(got.messages.length, 2);
  assert.equal(got.messages[1].sources[0], 'a.txt');

  const all = await conv.readConversations();
  assert.equal(all.length, 1);
});

test('conversation JSON persistence: delete', async () => {
  const conv = await import('../utils/conversations.js');
  await conv.saveConversation({ id: 'conv-test-2', title: 't2', messages: [], createdAt: 1, updatedAt: 1 });
  await conv.deleteConversation('conv-test-2');
  const got = await conv.getConversation('conv-test-2');
  assert.equal(got, null);
});

test('feedback persistence: basic append behavior', async () => {
  const store = await import('../utils/store.js');
  await store.addFeedback({ conversationId: 'c1', messageIndex: 0, rating: 1 });
  await store.addFeedback({ conversationId: 'c1', messageIndex: 1, rating: -1 });

  const all = await store.getFeedback();
  assert.equal(all.length, 2);
  assert.equal(all[0].rating, 1);
  assert.equal(all[1].rating, -1);
  assert.equal(typeof all[0].timestamp, 'number');
});
