import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

let tmpDir;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zeraea-atomic-'));
  process.env.ZERAEH_DATA_DIR = tmpDir;
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.ZERAEH_DATA_DIR;
});

test('S16: 20 parallel conversation writes keep all entries and valid JSON', async () => {
  const conv = await import('../utils/conversations.js');
  const ids = Array.from({ length: 20 }, (_, i) => `parallel-conv-${i}`);

  await Promise.all(ids.map((id, i) => conv.saveConversation({
    id,
    title: `محادثة ${i}`,
    messages: [{ role: 'user', content: `msg ${i}` }],
    createdAt: i,
    updatedAt: i,
  })));

  const all = await conv.readConversations();
  assert.equal(all.length, 20, 'no entry may be lost by concurrent writes');

  const raw = await fs.readFile(path.join(tmpDir, 'conversations.json'), 'utf-8');
  assert.doesNotThrow(() => JSON.parse(raw), 'file must remain valid JSON');
});

test('S16: 20 parallel feedback appends keep all entries and valid JSON', async () => {
  const store = await import('../utils/store.js');
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    store.addFeedback({ conversationId: 'c', messageIndex: i, rating: i % 2 === 0 ? 1 : -1 })
  ));

  const all = await store.getFeedback();
  assert.equal(all.length, 20, 'no feedback entry may be lost');
  assert.equal(new Set(all.map(f => f.messageIndex)).size, 20);

  const raw = await fs.readFile(path.join(tmpDir, 'feedback.json'), 'utf-8');
  assert.doesNotThrow(() => JSON.parse(raw));
});
