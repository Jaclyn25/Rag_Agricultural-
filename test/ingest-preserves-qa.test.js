import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

let tmpData;
let tmpKnowledge;

before(async () => {
  tmpData = await fs.mkdtemp(path.join(os.tmpdir(), 'zeraea-ingest-'));
  tmpKnowledge = await fs.mkdtemp(path.join(os.tmpdir(), 'zeraea-kb-'));
  await fs.writeFile(path.join(tmpKnowledge, 'doc.txt'), 'التربة الرملية تحتاج إلى ري متكرر.', 'utf-8');
  process.env.ZERAEH_DATA_DIR = tmpData;
  process.env.ZERAEH_KNOWLEDGE_DIR = tmpKnowledge;
});

after(async () => {
  await fs.rm(tmpData, { recursive: true, force: true });
  await fs.rm(tmpKnowledge, { recursive: true, force: true });
});

test('S15: re-ingestion preserves admin QA alongside curated documents', async () => {
  const store = await import('../utils/store.js');
  const { ingestAll } = await import('../server/ingest.js');

  const qa = await store.addQAKnowledge({
    question: 'هل الطماطم تحتاج شمساً؟',
    answer: 'نعم تحتاج الطماطم لساعات كافية من الشمس يومياً.',
  });
  assert.equal(qa.created, true);

  const total = await ingestAll();
  assert.ok(total >= 2, 'doc + QA chunks must be indexed');

  const vectors = await store.readStore();
  assert.ok(vectors.some(v => v.source === 'doc.txt'), 'curated doc must be indexed');
  const qaVector = vectors.find(v => (v.tags || []).includes(`qa:${qa.entry.id}`));
  assert.ok(qaVector, 'admin QA must survive re-ingestion');
  assert.equal(qaVector.source, 'user_qa');
});
