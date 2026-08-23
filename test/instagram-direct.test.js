import test from 'node:test';
import assert from 'node:assert/strict';
import { publishInstagramImage, waitForInstagramContainer } from '../src/lib/instagram-direct.js';

function jsonResponse(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return data; } };
}

test('waits for Instagram media container before publishing', async () => {
  const calls = [];
  const responses = [
    jsonResponse({ id: 'container-1' }),
    jsonResponse({ status_code: 'IN_PROGRESS' }),
    jsonResponse({ status_code: 'FINISHED' }),
    jsonResponse({ id: 'media-99' })
  ];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch');
    return next;
  };
  let sleeps = 0;

  const result = await publishInstagramImage({
    igUserId: 'ig-123',
    token: 'secret-token',
    imageUrl: 'https://example.test/image.jpg',
    caption: 'Table Rock Press test',
    fetchFn,
    sleep: async () => { sleeps++; },
    maxAttempts: 4,
    pollIntervalMs: 1
  });

  assert.equal(result.externalId, 'media-99');
  assert.equal(result.creationId, 'container-1');
  assert.equal(result.state, 'published');
  assert.equal(sleeps, 1);
  assert.equal(calls.length, 4);
  assert.match(calls[0].url, /ig-123\/media$/);
  assert.match(calls[1].url, /container-1\?/);
  assert.match(calls[2].url, /container-1\?/);
  assert.match(calls[3].url, /ig-123\/media_publish$/);
});

test('fails closed when Instagram container reports ERROR', async () => {
  const fetchFn = async () => jsonResponse({ status_code: 'ERROR', status: 'Image download failed' });
  await assert.rejects(
    waitForInstagramContainer({
      creationId: 'container-bad',
      token: 'secret-token',
      fetchFn,
      sleep: async () => {},
      maxAttempts: 2,
      pollIntervalMs: 1
    }),
    /container error: Image download failed/i
  );
});

test('does not publish an unready Instagram container after timeout', async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return jsonResponse({ status_code: 'IN_PROGRESS' }); };
  await assert.rejects(
    waitForInstagramContainer({
      creationId: 'container-slow',
      token: 'secret-token',
      fetchFn,
      sleep: async () => {},
      maxAttempts: 3,
      pollIntervalMs: 1
    }),
    /not ready after 3 checks/i
  );
  assert.equal(calls, 3);
});

test('surfaces Graph API errors without leaking into a publish attempt', async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return jsonResponse({ error: { message: 'Invalid OAuth access token' } }, 400);
  };
  await assert.rejects(
    publishInstagramImage({
      igUserId: 'ig-123',
      token: 'bad-token',
      imageUrl: 'https://example.test/image.jpg',
      fetchFn
    }),
    /Instagram create 400: Invalid OAuth access token/
  );
  assert.equal(calls, 1);
});
