import base from './entry.js';
import { setting, setSetting, health, resolveHealth } from './lib/db.js';
import { driveSyncConfigured, syncGoogleDrive, DEFAULT_DRIVE_FOLDER_ID } from './lib/google-drive-sync.js';
import { beginGoogleDriveOAuth, completeGoogleDriveOAuth, googleDriveRedirectUri } from './lib/google-drive-oauth.js';
import { currentUser } from './lib/auth.js';
import { sendAlertOnce, alertEmailConfigured } from './lib/notifications.js';
import { nowIso } from './lib/utils.js';

const DRIVE_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const META_GRAPH_VERSION='v25.0';

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

function safeDriveStatus(env, origin) {
  return {
    ok: true,
    configured: driveSyncConfigured(env),
    client_id_present: Boolean(env.GOOGLE_DRIVE_CLIENT_ID),
    client_secret_present: Boolean(env.GOOGLE_DRIVE_CLIENT_SECRET),
    refresh_token_present: Boolean(env.GOOGLE_DRIVE_REFRESH_TOKEN),
    folder_id: env.GOOGLE_DRIVE_FOLDER_ID || DEFAULT_DRIVE_FOLDER_ID,
    redirect_uri: googleDriveRedirectUri(origin)
  };
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function oauthTokenPage(refreshToken) {
  const token = escapeHtml(refreshToken);
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Drive authorized</title><style>body{font-family:system-ui;background:#111;color:#eee;padding:32px;max-width:760px;margin:auto}.card{background:#1c1c1c;padding:24px;border-radius:14px}code{word-break:break-all;background:#090909;padding:12px;display:block;border-radius:8px}a{color:#9fd3ff}</style><div class="card"><h1>Google Drive authorized</h1><p>Google returned the required refresh token. Save this once as the Cloudflare Worker secret <strong>GOOGLE_DRIVE_REFRESH_TOKEN</strong>. Do not post or share it anywhere else.</p><code>${token}</code><p>After the secret is saved, return to Marketing Autopilot. The scheduler will import the Drive content automatically.</p><p><a href="/">Return to Marketing Autopilot</a></p></div>`, { status:200, headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'} });
}

function oauthErrorPage(message) {
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Drive authorization failed</title><body style="font-family:system-ui;background:#111;color:#eee;padding:32px;max-width:760px;margin:auto"><h1>Google Drive authorization failed</h1><p>${escapeHtml(message)}</p><p><a style="color:#9fd3ff" href="/">Return to Marketing Autopilot</a></p></body>`, { status:400, headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'} });
}

async function redirectFacebookOAuth(request, env) {
  const user = await currentUser(env, request);
  if (!user) return new Response(JSON.stringify({ error:'Authentication required' }), { status:401, headers:{'content-type':'application/json; charset=utf-8'} });
  if (user.role === 'viewer') return new Response(JSON.stringify({ error:'Viewer accounts are read-only' }), { status:403, headers:{'content-type':'application/json; charset=utf-8'} });
  if (!env.META_APP_ID || !env.META_APP_SECRET) return new Response(JSON.stringify({ error:'Facebook authorization is not configured yet. META_APP_ID and META_APP_SECRET are required.' }), { status:503, headers:{'content-type':'application/json; charset=utf-8'} });
  const origin = new URL(request.url).origin;
  const state = crypto.randomUUID();
  await setSetting(env, `oauth:facebook:${state}`, { created_at:nowIso(), user_id:user.id });
  const redirectUri = `${origin}/oauth/facebook/callback`;
  const params = new URLSearchParams({
    client_id:String(env.META_APP_ID),
    redirect_uri:redirectUri,
    state,
    response_type:'code',
    scope:'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish'
  });
  return Response.redirect(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params.toString()}`,302);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/connectors/facebook/oauth/start') {
      try {
        return await redirectFacebookOAuth(request, env);
      } catch (e) {
        await health(env,'connect:facebook','yellow',String(e.message||e).slice(0,300));
        return new Response(JSON.stringify({ error:String(e.message||e) }), { status:400, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'} });
      }
    }
    if (request.method === 'GET' && url.pathname === '/system/drive-status') {
      const syncStatus = await setting(env, 'drive_sync_status', {});
      return new Response(JSON.stringify({ ...safeDriveStatus(env, url.origin), sync_status:syncStatus }), {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store'
        }
      });
    }
    if (request.method === 'GET' && url.pathname === '/system/alert-test') {
      const user = await currentUser(env, request);
      if (!user) return new Response(JSON.stringify({ error:'Authentication required' }), { status:401, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'} });
      if (user.role === 'viewer') return new Response(JSON.stringify({ error:'Viewer accounts are read-only' }), { status:403, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'} });
      const config = {
        configured: alertEmailConfigured(env),
        resend_api_key_present: Boolean(env.RESEND_API_KEY),
        alert_email_to_present: Boolean(env.ALERT_EMAIL_TO),
        alert_email_from_present: Boolean(env.ALERT_EMAIL_FROM)
      };
      if (!config.configured) return new Response(JSON.stringify({ ok:false, ...config }), { status:503, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'} });
      try {
        const result = await sendAlertOnce(env, {
          key:`manual-alert-test:${crypto.randomUUID()}`,
          subject:'Marketing Autopilot test alert',
          text:'Marketing Autopilot alert delivery test succeeded.'
        });
        return new Response(JSON.stringify({ ok:true, ...config, result }), { status:200, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'} });
      } catch (e) {
        await health(env,'notifications:test','yellow',`Manual alert test failed: ${String(e.message||e).slice(0,300)}`);
        return new Response(JSON.stringify({ ok:false, ...config, error:String(e.message||e) }), { status:502, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'} });
      }
    }
    if (request.method === 'GET' && url.pathname === '/system/google-drive/oauth/start') {
      const user = await currentUser(env, request);
      if (!user) return new Response(JSON.stringify({ error:'Authentication required' }), { status:401, headers:{'content-type':'application/json; charset=utf-8'} });
      if (user.role === 'viewer') return new Response(JSON.stringify({ error:'Viewer accounts are read-only' }), { status:403, headers:{'content-type':'application/json; charset=utf-8'} });
      try {
        const result = await beginGoogleDriveOAuth(env, url.origin);
        return Response.redirect(result.authorization_url, 302);
      } catch (e) {
        await health(env, 'connect:google-drive', 'yellow', String(e.message || e).slice(0, 300));
        return new Response(JSON.stringify({ error:String(e.message || e), redirect_uri:googleDriveRedirectUri(url.origin) }), { status:400, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'} });
      }
    }
    if (request.method === 'GET' && url.pathname === '/oauth/google-drive/callback') {
      const externalError = url.searchParams.get('error_description') || url.searchParams.get('error');
      if (externalError) {
        await health(env, 'connect:google-drive', 'yellow', String(externalError).slice(0, 300));
        return oauthErrorPage(externalError);
      }
      try {
        const result = await completeGoogleDriveOAuth(env, {
          origin:url.origin,
          state:url.searchParams.get('state') || '',
          code:url.searchParams.get('code') || ''
        });
        await resolveHealth(env, 'connect:google-drive');
        return oauthTokenPage(result.refresh_token);
      } catch (e) {
        await health(env, 'connect:google-drive', 'yellow', String(e.message || e).slice(0, 300));
        return oauthErrorPage(String(e.message || e));
      }
    }
    return base.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    await base.scheduled(controller, env, ctx);
    // Drive ingestion runs outside browser requests and follows the five-minute cron.
    if (controller.cron === '*/5 * * * *') await syncDriveIfDue(env);
  }
};
