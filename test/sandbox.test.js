import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSandboxConnectors } from '../src/lib/sandbox.js';

function fakeEnv(initial = []) {
  const rows = initial.map(x => ({ ...x }));
  const DB = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("COUNT(*) n FROM connectors")) {
                const [platform] = args;
                return { n: rows.filter(r => r.platform === platform && r.connector_type !== 'sandbox' && r.enabled === 1).length };
              }
              if (sql.includes("SELECT id FROM connectors") && sql.includes("connector_type='sandbox'")) {
                const [platform] = args;
                const found = rows.filter(r => r.platform === platform && r.connector_type === 'sandbox').sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')))[0];
                return found ? { id: found.id } : null;
              }
              throw new Error(`Unexpected first SQL: ${sql}`);
            },
            async run() {
              if (sql.includes("UPDATE connectors SET enabled=0") && sql.includes("connector_type='sandbox'")) {
                const [, platform] = args;
                for (const r of rows) if (r.platform === platform && r.connector_type === 'sandbox' && r.enabled !== 0) r.enabled = 0;
                return { meta: { changes: 1 } };
              }
              if (sql.includes("UPDATE connectors SET enabled=CASE WHEN id=?")) {
                const [keepId, , platform] = args;
                for (const r of rows) if (r.platform === platform && r.connector_type === 'sandbox') r.enabled = r.id === keepId ? 1 : 0;
                return { meta: { changes: 1 } };
              }
              if (sql.includes("INSERT INTO connectors") && sql.includes("'sandbox'")) {
                const [id, name, connectorType, platform, createdAt, updatedAt] = args;
                rows.push({ id, name, connector_type: connectorType, platform, enabled: 1, priority: 999, cost_cents_per_post: 0, created_at: createdAt, updated_at: updatedAt });
                return { meta: { changes: 1 } };
              }
              throw new Error(`Unexpected run SQL: ${sql}`);
            }
          };
        }
      };
    }
  };
  return { env: { DB }, rows };
}

test('sandbox bootstrap creates one zero-cost fallback per platform when no real connector is active', async () => {
  const { env, rows } = fakeEnv();
  await ensureSandboxConnectors(env);
  const sandboxes = rows.filter(r => r.connector_type === 'sandbox');
  assert.equal(sandboxes.length, 5);
  assert.deepEqual(sandboxes.map(r => r.platform).sort(), ['email','facebook','instagram','pinterest','tiktok']);
  assert.ok(sandboxes.every(r => r.enabled === 1 && r.cost_cents_per_post === 0));
});

test('sandbox bootstrap disables fallback when a real connector is active', async () => {
  const { env, rows } = fakeEnv([
    { id:'real-facebook', platform:'facebook', connector_type:'meta_facebook', enabled:1, created_at:'2026-08-20T00:00:00Z' },
    { id:'sandbox-facebook', platform:'facebook', connector_type:'sandbox', enabled:1, created_at:'2026-08-19T00:00:00Z' }
  ]);
  await ensureSandboxConnectors(env);
  assert.equal(rows.find(r => r.id === 'sandbox-facebook').enabled, 0);
  assert.equal(rows.find(r => r.id === 'real-facebook').enabled, 1);
});

test('sandbox bootstrap keeps only one fallback enabled when duplicates exist', async () => {
  const { env, rows } = fakeEnv([
    { id:'sandbox-a', platform:'instagram', connector_type:'sandbox', enabled:1, created_at:'2026-08-18T00:00:00Z' },
    { id:'sandbox-b', platform:'instagram', connector_type:'sandbox', enabled:1, created_at:'2026-08-19T00:00:00Z' }
  ]);
  await ensureSandboxConnectors(env);
  const enabled = rows.filter(r => r.platform === 'instagram' && r.connector_type === 'sandbox' && r.enabled === 1);
  assert.equal(enabled.length, 1);
  assert.equal(enabled[0].id, 'sandbox-a');
});
