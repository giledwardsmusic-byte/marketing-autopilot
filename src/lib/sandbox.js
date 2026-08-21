import { nowIso } from './utils.js';

const PLATFORMS = ['facebook','instagram','tiktok','pinterest','email'];

export async function ensureSandboxConnectors(env) {
  const t = nowIso();
  for (const platform of PLATFORMS) {
    const real = await env.DB.prepare(`SELECT COUNT(*) n FROM connectors WHERE platform=? AND connector_type<>'sandbox' AND enabled=1`).bind(platform).first();
    if (Number(real?.n || 0) > 0) {
      await env.DB.prepare(`UPDATE connectors SET enabled=0,updated_at=? WHERE platform=? AND connector_type='sandbox' AND enabled<>0`).bind(t,platform).run();
      continue;
    }

    const existing = await env.DB.prepare(`SELECT id FROM connectors WHERE platform=? AND connector_type='sandbox' ORDER BY created_at LIMIT 1`).bind(platform).first();
    if (existing?.id) {
      await env.DB.prepare(`UPDATE connectors SET enabled=CASE WHEN id=? THEN 1 ELSE 0 END,updated_at=? WHERE platform=? AND connector_type='sandbox'`).bind(existing.id,t,platform).run();
      continue;
    }

    await env.DB.prepare(`INSERT INTO connectors(id,name,connector_type,platform,enabled,priority,cost_cents_per_post,config_json,created_at,updated_at) VALUES(?,?,?,?,1,999,0,'{}',?,?)`).bind(`sandbox_${platform}`,`Sandbox ${platform}`,'sandbox',platform,t,t).run();
  }
}
