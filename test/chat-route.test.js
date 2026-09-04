import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';

let askCall = null;

function fakeStream() {
  return (async function* () {
    yield { choices: [{ delta: { content: 'مرحباً' } }] };
    yield { choices: [{ delta: { content: ' بالزراعة' } }] };
  })();
}

mock.module('../server/chat.js', {
  namedExports: {
    askQuestion: async (question, history, options) => {
      askCall = { question, history, options };
      return { stream: fakeStream(), sources: ['fake_source.txt'], noContext: false, experimentId: 'test-exp' };
    },
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

test('chat route happy path streams an answer without calling a real provider', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'ما هي التربة الزراعية؟', conversationId: 'test-conv-1' }),
  });

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);

  const text = await res.text();
  assert.match(text, /مرحباً/);
  assert.match(text, /fake_source\.txt/);
  assert.match(text, /\[DONE\]/);

  assert.ok(askCall, 'askQuestion should have been called');
  assert.equal(askCall.question, 'ما هي التربة الزراعية؟');
  assert.equal(askCall.options.model, 'groq');
});

test('chat route rejects a missing question with 400', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: 'x' }),
  });
  assert.equal(res.status, 400);
});
