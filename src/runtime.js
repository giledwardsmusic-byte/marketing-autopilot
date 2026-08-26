import base from './entry.js';
import { setting, health } from './lib/db.js';
import { driveSyncConfigured, syncGoogleDrive } from './lib/google-drive-sync.js';

const DRIVE_SYNC_INTERVAL_MS = 60 * 60 * 1000;

export function driveSyncDue(status, nowMs = Date.now()) {
  const last = Date.parse(status?.last_success_at || '');
  return !Number.isFinite(last) || (nowMs - last) >= DRIVE_SYNC_INTERVAL_MS;
}

async function syncDriveIfDue(env) {
  if (!driveSyncConfigured(env)) return { state: 'disabled' };
  const status = await setting(env, 'drive_sync_status', {});
  if (!driveSyncDue(status)) return { state: 'fresh' };
  try {
    return await syncGoogleDrive(env);
  } catch (e) {
    await health(env, 'google-drive', 'yellow', `Drive sync retry failed: ${String(e.message || e).slice(0, 300)}`);
    return { state: 'failed', error: String(e.message || e) };
  }
}

async function safeDriveStatus(env) {
  const configured = driveSyncConfigured(env);
  const status = await setting(env, 'drive_sync_status', {});
  const [assetRow, copyRow, healthRow] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) n FROM assets WHERE perceptual_hint LIKE 'drive:%' OR r2_key LIKE 'drive-source/%'`).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM copy_items WHERE id LIKE 'cpy_drive_%'`).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM health_events WHERE resolved=0 AND code IN ('google-drive','google-drive-media')`).first()
  ]);
  return {
    ok: true,
    configured,
    sync_due: configured ? driveSyncDue(status) : false,
    last_success_at: status?.last_success_at || null,
    source_files: Number(status?.source_files || 0),
    media_imported_last_sync: Number(status?.media_imported || 0),
    media_failed_last_sync: Number(status?.media_failed || 0),
    drive_assets: Number(assetRow?.n || 0),
    drive_copy_items: Number(copyRow?.n || 0),
    unresolved_drive_health: Number(healthRow?.n || 0),
    folder_id: status?.folder_id || null
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/system/drive-status') {
      return new Response(JSON.stringify(await safeDriveStatus(env)), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        }
      });
    }
    return base.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    await base.scheduled(controller, env, ctx);
    // The base worker performs its full daily Drive sync at 03:17 UTC.
    // On the existing five-minute trigger, retry only when the last successful
    // sync is missing or at least one hour old. This makes first-time creative
    // ingestion prompt without turning every scheduler tick into Drive traffic.
    if (controller.cron === '*/5 * * * *') await syncDriveIfDue(env);
  }
};
