import base from './entry.js';
import { setting, health } from './lib/db.js';
import { driveSyncConfigured, syncGoogleDrive, DEFAULT_DRIVE_FOLDER_ID } from './lib/google-drive-sync.js';

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

function safeDriveStatus(env) {
  return {
    ok: true,
    configured: driveSyncConfigured(env),
    client_id_present: Boolean(env.GOOGLE_DRIVE_CLIENT_ID),
    client_secret_present: Boolean(env.GOOGLE_DRIVE_CLIENT_SECRET),
    refresh_token_present: Boolean(env.GOOGLE_DRIVE_REFRESH_TOKEN),
    folder_id: env.GOOGLE_DRIVE_FOLDER_ID || DEFAULT_DRIVE_FOLDER_ID
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/system/drive-status') {
      return new Response(JSON.stringify(safeDriveStatus(env)), {
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
