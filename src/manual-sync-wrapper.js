import runtime from './runtime.js';
import { currentUser } from './lib/auth.js';
import { setting, health } from './lib/db.js';
import { driveSyncConfigured, syncGoogleDrive } from './lib/google-drive-sync.js';
import { ensureAutopilotCampaigns } from './lib/autopilot-maintenance.js';

function progressPage(result) {
  const pending=Number(result?.media?.pending||0);
  const processed=Number(result?.media?.processed||0);
  const html=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="2"><title>Marketing Autopilot Drive Sync</title></head><body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.4"><h2>Drive sync is working</h2><p>Processed this batch: ${processed}</p><p>Remaining media: ${pending}</p><p>This page will continue automatically. Do not close it yet.</p></body></html>`;
  return new Response(html,{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
}

async function browserDriveSync(request, env) {
  const user = await currentUser(env, request);
  if (!user) return Response.redirect(new URL('/', request.url), 302);
  if (user.role === 'viewer') {
    return new Response(JSON.stringify({ ok:false, error:'Viewer accounts are read-only' }), {
      status:403,
      headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
    });
  }
  if (!driveSyncConfigured(env)) {
    return new Response(JSON.stringify({ ok:false, error:'Google Drive synchronization is not configured' }), {
      status:503,
      headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
    });
  }
  try {
    const result = await syncGoogleDrive(env);
    if (result?.state === 'partial') return progressPage(result);
    const campaigns = await ensureAutopilotCampaigns(env);
    const sync_status = await setting(env, 'drive_sync_status', {});
    return new Response(JSON.stringify({ ok:true, result, sync_status, campaigns }, null, 2), {
      status:200,
      headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
    });
  } catch (e) {
    await health(env, 'google-drive', 'yellow', `Browser Drive sync failed: ${String(e.message || e).slice(0,300)}`);
    return new Response(JSON.stringify({ ok:false, error:String(e.message || e) }, null, 2), {
      status:502,
      headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/system/drive-sync-browser') {
      return browserDriveSync(request, env);
    }
    return runtime.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return runtime.scheduled(controller, env, ctx);
  }
};
