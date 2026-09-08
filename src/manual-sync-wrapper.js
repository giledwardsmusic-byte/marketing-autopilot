import runtime from './runtime.js';
import { currentUser } from './lib/auth.js';
import { setting, health } from './lib/db.js';
import { driveSyncConfigured, syncGoogleDrive } from './lib/google-drive-sync.js';

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
    const sync_status = await setting(env, 'drive_sync_status', {});
    return new Response(JSON.stringify({ ok:true, result, sync_status }, null, 2), {
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
