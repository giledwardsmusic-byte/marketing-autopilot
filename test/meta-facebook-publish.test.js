import test from 'node:test';
import assert from 'node:assert/strict';
import { publishOne } from '../src/lib/publishers.js';
import { encryptCredential } from '../src/lib/security.js';

function fakeEnv({ connector, settings = {}, usedCents = 0 } = {}) {
  const updates = [];

  function statement(sql, args = []) {
    return {
      bind(...nextArgs) { return statement(sql, nextArgs); },
      async first() {
        if (sql.includes('SELECT value_json FROM settings WHERE key=?')) {
          const [key] = args;
          return Object.prototype.hasOwnProperty.call(settings, key)
            ? { value_json: JSON.stringify(settings[key]) }
            : null;
        }
        if (sql.includes('COALESCE(SUM(amount_cents),0) used FROM cost_usage')) {
          return { used: usedCents };
        }
        throw new Error(`Unexpected first SQL: ${sql}`);
      },
      async all() {
        if (sql.includes('SELECT * FROM connectors WHERE platform=? AND enabled=1')) {
          const [platform] = args;
          return { results: connector && connector.platform === platform && connector.enabled === 1 ? [connector] : [] };
        }
        throw new Error(`Unexpected all SQL: ${sql}`);
      },
      async run() {
        if (sql.includes('UPDATE connectors SET last_success_at=')) {
          const [lastSuccessAt, updatedAt, id] = args;
          updates.push({ type: 'success', id, lastSuccessAt, updatedAt });
          return { meta: { changes: 1 } };
        }
        if (sql.includes('UPDATE connectors SET last_error_at=')) {
          const [lastErrorAt, lastError, updatedAt, id] = args;
          updates.push({ type: 'error', id, lastErrorAt, lastError, updatedAt });
          return { meta: { changes: 1 } };
        }
        if (sql.includes('INSERT INTO cost_usage')) {
          updates.push({ type: 'cost' });
          return { meta: { changes: 1 } };
        }
        throw new Error(`Unexpected run SQL: ${sql}`);
      }
    };
  }

  return {
    env: { DB: { prepare(sql) { return statement(sql); } }, APP_ORIGIN: 'https://example.test' },
    updates
  };
}

test('valid Facebook connector decrypts its token, calls Graph API, and records a zero-cost publish', async () => {
  const keyBytes = new Uint8Array(32).fill(7);
  const credentialKey = btoa(String.fromCharCode(...keyBytes));
  const cryptoEnv = { CREDENTIAL_ENCRYPTION_KEY: credentialKey };
  const encrypted = await encryptCredential(cryptoEnv, 'test-page-token');

  const connector = {
    id: 'real-facebook',
    name: 'Facebook direct',
    connector_type: 'meta_facebook',
    platform: 'facebook',
    enabled: 1,
    priority: 1,
    cost_cents_per_post: 0,
    config_json: JSON.stringify({ page_id: '123456789' }),
    secret_ciphertext: encrypted.ciphertext,
    secret_iv: encrypted.iv
  };

  const { env, updates } = fakeEnv({
    connector,
    settings: {
      cost_control: { approved_monthly_cost_cents: 0 },
      runtime_origin: { origin: 'https://example.test' }
    }
  });
  env.CREDENTIAL_ENCRYPTION_KEY = credentialKey;

  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return {
      ok: true,
      status: 200,
      async json() { return { id: 'facebook-post-abc' }; }
    };
  };

  try {
    const result = await publishOne(env, {
      id: 'post-live-proof',
      platform: 'facebook',
      caption: 'Marketing Autopilot Facebook success-path test',
      public_token: null
    });

    assert.equal(result.state, 'published');
    assert.equal(result.externalId, 'facebook-post-abc');
    assert.equal(result.connector.id, 'real-facebook');
    assert.equal(request.url, 'https://graph.facebook.com/v25.0/123456789/feed');
    assert.equal(request.init.method, 'POST');

    const form = new URLSearchParams(request.init.body);
    assert.equal(form.get('message'), 'Marketing Autopilot Facebook success-path test');
    assert.equal(form.get('access_token'), 'test-page-token');

    assert.equal(updates.filter(x => x.type === 'success' && x.id === 'real-facebook').length, 1);
    assert.equal(updates.filter(x => x.type === 'error').length, 0);
    assert.equal(updates.filter(x => x.type === 'cost').length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
