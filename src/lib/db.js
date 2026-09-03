import { id, nowIso } from './utils.js';

export async function audit(env, { userId=null, type, entityType=null, entityId=null, summary, data={} }) {
  await env.DB.prepare(`INSERT INTO audit_events(id,user_id,event_type,entity_type,entity_id,summary,data_json,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(id('audit'), userId, type, entityType, entityId, summary, JSON.stringify(data), nowIso()).run();
}

export async function health(env, component, severity, message) {
  const existing = await env.DB.prepare(`SELECT id FROM health_events WHERE component=? AND resolved=0 LIMIT 1`).bind(component).first();
  if (!existing) await env.DB.prepare(`INSERT INTO health_events(id,component,severity,message,resolved,created_at) VALUES(?,?,?,?,0,?)`)
    .bind(id('health'), component, severity, message, nowIso()).run();
}

export async function resolveHealth(env, component) {
  await env.DB.prepare(`UPDATE health_events SET resolved=1,resolved_at=? WHERE component=? AND resolved=0`).bind(nowIso(), component).run();
}

export async function setting(env, key, fallback={}) {
  const row = await env.DB.prepare(`SELECT value_json FROM settings WHERE key=?`).bind(key).first();
  if (!row) return fallback;
  try { return JSON.parse(row.value_json); } catch { return fallback; }
}

export async function setSetting(env, key, value) {
  await env.DB.prepare(`INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
    .bind(key, JSON.stringify(value), nowIso()).run();
}
