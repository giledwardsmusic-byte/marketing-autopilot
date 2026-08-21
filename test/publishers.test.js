import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleConnectors, publishOne } from '../src/lib/publishers.js';

function fakeEnv({ connectors = [], settings = {}, usedCents = 0 } = {}) {
  const rows = connectors.map(x => ({ ...x }));
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
          return {
            results: rows
              .filter(r => r.platform === platform && r.enabled === 1)
              .sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0) || Number(a.cost_cents_per_post || 0) - Number(b.cost_cents_per_post || 0))
          };
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

  const DB = { prepare(sql) { return statement(sql); } };
  return { env: { DB, APP_ORIGIN: 'https://example.test' }, rows, updates };
}

test('sandbox publish path returns simulated state and records connector success without cost', async () => {
  const { env, updates } = fakeEnv({
    connectors: [
      { id: 'sandbox-facebook', name: 'Sandbox facebook', connector_type: 'sandbox', platform: 'facebook', enabled: 1, priority: 999, cost_cents_per_post: 0, config_json: '{}' }
    ],
    settings: {
      cost_control: { approved_monthly_cost_cents: 0 },
      runtime_origin: { origin: 'https://example.test' }
    }
  });

  const result = await publishOne(env, {
    id: 'post-1',
    platform: 'facebook',
    caption: 'Sandbox test',
    public_token: null
  });

  assert.equal(result.state, 'simulated');
  assert.equal(result.externalId, 'sandbox_post-1');
  assert.equal(result.connector.id, 'sandbox-facebook');
  assert.equal(updates.filter(x => x.type === 'success').length, 1);
  assert.equal(updates.filter(x => x.type === 'cost').length, 0);
});

test('zero-dollar cost ceiling excludes paid publishing routes', async () => {
  const { env } = fakeEnv({
    connectors: [
      { id: 'paid-facebook', name: 'Paid route', connector_type: 'buffer', platform: 'facebook', enabled: 1, priority: 1, cost_cents_per_post: 1, config_json: '{}' },
      { id: 'sandbox-facebook', name: 'Sandbox facebook', connector_type: 'sandbox', platform: 'facebook', enabled: 1, priority: 999, cost_cents_per_post: 0, config_json: '{}' }
    ],
    settings: { cost_control: { approved_monthly_cost_cents: 0 } }
  });

  const eligible = await eligibleConnectors(env, 'facebook');
  assert.deepEqual(eligible.map(c => c.id), ['sandbox-facebook']);
});
