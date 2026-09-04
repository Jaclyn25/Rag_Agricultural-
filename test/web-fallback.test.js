import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWebFallbackMessages } from '../server/chat.js';

test('S6: fallback prompt is in Arabic and agriculture-only', () => {
  const messages = buildWebFallbackMessages('كيف أزرع الطماطم في تربة رملية؟', []);
  assert.equal(messages.length, 2, 'system + user');
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /agriculture only/i);
  assert.match(messages[1].content, /باللغة العربية الفصحى/);
  assert.match(messages[1].content, /الأسئلة الزراعية/);
});

test('S6: fallback refuses unrelated questions (no general-assistant answers)', () => {
  const forCapital = buildWebFallbackMessages('ما عاصمة فرنسا؟', []);
  const forCode = buildWebFallbackMessages('اكتب لي كود بايثون', []);
  assert.match(forCapital[1].content, /خارج الزراعة تماماً/);
  assert.match(forCode[1].content, /خارج الزراعة تماماً/);
  assert.match(forCapital[1].content, /تخصصك هو الإجابة على الأسئلة الزراعية فقط/);
});

test('S6: fallback distinguishes general knowledge from local KB', () => {
  const messages = buildWebFallbackMessages('كيف أزرع الطماطم في تربة رملية؟', []);
  assert.match(messages[1].content, /ليست من قاعدة المعرفة المحلية/);
  assert.match(messages[1].content, /لم أجد هذه المعلومة في قاعدة المعرفة المحلية/);
});

test('S6: fallback forbids fabricating local-document citations', () => {
  const messages = buildWebFallbackMessages('ما هي مكافحة الآفات؟', []);
  assert.match(messages[1].content, /لا تختلق استشهادات/);
  assert.match(messages[1].content, /لا تذكر أي اسم مصدر من قاعدة المعرفة المحلية/);
});

test('S6: fallback includes conversation history (last 6 messages)', () => {
  const history = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `msg-${i}` }));
  const messages = buildWebFallbackMessages('سؤال جديد', history);
  assert.equal(messages.length, 8, 'system + 6 history + user');
  assert.equal(messages[1].content, 'msg-2', 'oldest kept message');
  assert.equal(messages[6].content, 'msg-7', 'newest history message');
});
