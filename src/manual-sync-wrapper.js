import runtime from './runtime.js';
import { currentUser } from './lib/auth.js';
import { setting, health } from './lib/db.js';
import { driveSyncConfigured, syncGoogleDrive } from './lib/google-drive-sync.js';
import { ensureAutopilotCampaigns } from './lib/autopilot-maintenance.js';

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function html(body){return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marketing Autopilot</title></head><body style="font-family:system-ui,sans-serif;padding:24px;line-height:1.45;max-width:720px;margin:auto">${body}</body></html>`,{status:200,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});}
function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}

function progressPage(result) {
  const pending=Number(result?.media?.pending||0);
  const processed=Number(result?.media?.processed||0);
  const body=`<meta http-equiv="refresh" content="2"><h2>Drive sync is working</h2><p>Processed this batch: ${processed}</p><p>Remaining media: ${pending}</p><p>This page will continue automatically. Do not close it yet.</p>`;
  return html(body);
}

async function browserDriveSync(request, env) {
  const user = await currentUser(env, request);
  if (!user) return Response.redirect(new URL('/', request.url), 302);
  if (user.role === 'viewer') {
    return json({ ok:false, error:'Viewer accounts are read-only' },403);
  }
  if (!driveSyncConfigured(env)) {
    return json({ ok:false, error:'Google Drive synchronization is not configured' },503);
  }
  try {
    const result = await syncGoogleDrive(env);
    if (result?.state === 'partial') return progressPage(result);
    const campaigns = await ensureAutopilotCampaigns(env);
    const sync_status = await setting(env, 'drive_sync_status', {});
    return json({ ok:true, result, sync_status, campaigns });
  } catch (e) {
    await health(env, 'google-drive', 'yellow', `Browser Drive sync failed: ${String(e.message || e).slice(0,300)}`);
    return json({ ok:false, error:String(e.message || e) },502);
  }
}

async function liveProofPinterest(request, env) {
  const user=await currentUser(env,request);
  if(!user)return Response.redirect(new URL('/',request.url),302);
  if(user.role==='viewer')return html('<h2>Live proof unavailable</h2><p>Viewer accounts are read-only.</p>');
  const existing=await setting(env,'live_proof_pinterest',null);
  if(existing?.post_id){
    return Response.redirect(new URL(`/system/live-proof-pinterest-status?id=${encodeURIComponent(existing.post_id)}`,request.url),302);
  }
  const post=await env.DB.prepare(`SELECT sp.id,sp.caption,sp.scheduled_for,sp.status,p.name product_name,a.public_token,a.original_name
    FROM scheduled_posts sp
    LEFT JOIN products p ON p.id=sp.product_id
    LEFT JOIN assets a ON a.id=sp.asset_id
    WHERE lower(sp.platform)='pinterest'
      AND sp.status IN ('scheduled','approved')
      AND sp.scheduled_for>?
      AND lower(COALESCE(p.name,'')) LIKE '%buddy%'
    ORDER BY sp.scheduled_for ASC LIMIT 1`).bind(new Date().toISOString()).first();
  if(!post)return html('<h2>No Pinterest proof post found</h2><p>There is no future scheduled Buddy Pinterest post available to move forward.</p>');
  const original=post.scheduled_for;
  const due=new Date(Date.now()-30000).toISOString();
  await env.DB.prepare(`UPDATE scheduled_posts SET scheduled_for=?,status='approved',updated_at=? WHERE id=?`).bind(due,new Date().toISOString(),post.id).run();
  await setting(env,'live_proof_pinterest',null);
  await env.DB.prepare(`INSERT INTO settings(key,value_json,updated_at) VALUES('live_proof_pinterest',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
    .bind(JSON.stringify({post_id:post.id,original_scheduled_for:original,armed_at:new Date().toISOString(),product_name:post.product_name,asset_name:post.original_name}),new Date().toISOString()).run();
  return Response.redirect(new URL(`/system/live-proof-pinterest-status?id=${encodeURIComponent(post.id)}`,request.url),302);
}

async function liveProofPinterestStatus(request, env) {
  const user=await currentUser(env,request);
  if(!user)return Response.redirect(new URL('/',request.url),302);
  const id=new URL(request.url).searchParams.get('id')||'';
  const post=await env.DB.prepare(`SELECT sp.id,sp.platform,sp.caption,sp.scheduled_for,sp.status,sp.external_post_id,sp.published_at,sp.error_message,p.name product_name,a.public_token,a.original_name
    FROM scheduled_posts sp
    LEFT JOIN products p ON p.id=sp.product_id
    LEFT JOIN assets a ON a.id=sp.asset_id
    WHERE sp.id=? LIMIT 1`).bind(id).first();
  if(!post)return html('<h2>Live proof not found</h2>');
  const final=['published','failed','simulated'].includes(String(post.status));
  const refresh=final?'':'<meta http-equiv="refresh" content="5">';
  const image=post.public_token?`<img src="/public-media/${encodeURIComponent(post.public_token)}" alt="" style="max-width:220px;border-radius:12px">`:'';
  const state=post.status==='published'?'PUBLISHED SUCCESSFULLY':post.status==='failed'?'PUBLISH FAILED':post.status==='simulated'?'SIMULATED ONLY':'WAITING FOR AUTOMATIC PUBLISH';
  return html(`${refresh}<h1>${esc(state)}</h1>${post.error_message?`<div style="padding:16px;background:#fee;border:2px solid #c00;border-radius:10px"><strong>Full error:</strong><pre style="white-space:pre-wrap">${esc(post.error_message)}</pre></div>`:''}<p><strong>Platform:</strong> Pinterest</p><p><strong>Product:</strong> ${esc(post.product_name||'')}</p><p><strong>Graphic:</strong> ${esc(post.original_name||'')}</p>${image}<p><strong>Status:</strong> ${esc(post.status)}</p><p><strong>Published at:</strong> ${esc(post.published_at||'not yet')}</p><p><strong>External post ID:</strong> ${esc(post.external_post_id||'not yet')}</p><h3>Caption being tested</h3><p style="white-space:pre-wrap">${esc(post.caption||'')}</p>${final?'<p>You can send this screen back to ChatGPT.</p>':'<p>This page checks automatically every 5 seconds. Keep it open.</p>'}`);
}

async function pinterestDiagnostic(env){
  const post=await env.DB.prepare(`SELECT id,status,error_message,scheduled_for,published_at,external_post_id,updated_at FROM scheduled_posts WHERE lower(platform)='pinterest' AND status='failed' ORDER BY updated_at DESC LIMIT 1`).first();
  const connector=await env.DB.prepare(`SELECT id,name,connector_type,enabled,last_error_at,last_error,config_json FROM connectors WHERE lower(platform)='pinterest' ORDER BY priority ASC LIMIT 1`).first();
  let cfg={}; try{cfg=JSON.parse(connector?.config_json||'{}')}catch{}
  return json({ok:true,post:post||null,connector:connector?{id:connector.id,name:connector.name,connector_type:connector.connector_type,enabled:connector.enabled,last_error_at:connector.last_error_at,last_error:connector.last_error,board_id_present:Boolean(cfg.board_id),board_name:cfg.board_name||null}:null});
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/system/drive-sync-browser') return browserDriveSync(request, env);
    if (request.method === 'GET' && url.pathname === '/system/live-proof-pinterest') return liveProofPinterest(request, env);
    if (request.method === 'GET' && url.pathname === '/system/live-proof-pinterest-status') return liveProofPinterestStatus(request, env);
    if (request.method === 'GET' && url.pathname === '/system/live-proof-pinterest-diagnostic') return pinterestDiagnostic(env);
    return runtime.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    return runtime.scheduled(controller, env, ctx);
  }
};
