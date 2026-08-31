import base from './index.js';
import { ensureAutopilotCampaigns } from './lib/autopilot-maintenance.js';
import { health, resolveHealth, setting, setSetting } from './lib/db.js';
import { ensureSchema } from './lib/schema-bootstrap.js';
import { ensureSandboxConnectors } from './lib/sandbox.js';
import { ensureTableRockPressSeed } from './lib/table-rock-seed.js';
import { currentUser } from './lib/auth.js';
import { assertSameOrigin, encryptCredential } from './lib/security.js';
import { nowIso } from './lib/utils.js';
import { notifyPaidSale, notifyRecordedPaidSales, notifyUnresolvedHealth } from './lib/notifications.js';
import { serveImageVariant } from './lib/media-normalization.js';
import { syncGoogleDrive } from './lib/google-drive-sync.js';
import { reconcileTikTokSubmissions } from './lib/tiktok-reconcile.js';
import { connectInstagramFromFacebook } from './lib/instagram-connect.js';
import { beginPinterestOAuth, completePinterestOAuth, beginTikTokOAuth, completeTikTokOAuth, refreshSocialOAuthConnectors } from './lib/social-oauth-connect.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});
const SCHEDULER_LEASE_KEY='scheduler:lease';
const SCHEDULER_LEASE_MS=10*60*1000;
const MEDIA_RETRY_PREFIX='MEDIA_BLOCKED_RETRY:';
const TABLE_ROCK_PAGE_ID='1129450230257220';
const META_GRAPH_VERSION='v25.0';

export async function acquireSchedulerLease(env, now=new Date()){
  const token=crypto.randomUUID();
  const acquiredAt=now.toISOString();
  const expiresAt=new Date(now.getTime()+SCHEDULER_LEASE_MS).toISOString();
  const value=JSON.stringify({token,acquired_at:acquiredAt,expires_at:expiresAt});
  const result=await env.DB.prepare(`INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at
    WHERE json_extract(settings.value_json,'$.expires_at') IS NULL OR json_extract(settings.value_json,'$.expires_at')<=?`)
    .bind(SCHEDULER_LEASE_KEY,value,acquiredAt,acquiredAt).run();
  return Number(result.meta?.changes||0)>0?token:null;
}

export async function releaseSchedulerLease(env, token){
  if(!token)return;
  await env.DB.prepare(`DELETE FROM settings WHERE key=? AND json_extract(value_json,'$.token')=?`)
    .bind(SCHEDULER_LEASE_KEY,token).run();
}

export async function preflightDueMedia(env){
  const rows=(await env.DB.prepare(`SELECT sp.id,sp.platform,sp.status,sp.error_message,a.public_token
    FROM scheduled_posts sp JOIN assets a ON a.id=sp.asset_id
    WHERE sp.scheduled_for<=?
      AND a.public_token IS NOT NULL
      AND a.mime_type LIKE 'image/%'
      AND lower(sp.platform) IN ('facebook','instagram','pinterest','tiktok')
      AND (sp.status IN ('scheduled','approved') OR (sp.status='paused' AND sp.error_message LIKE ?))
    ORDER BY sp.scheduled_for ASC LIMIT 25`)
    .bind(nowIso(),`${MEDIA_RETRY_PREFIX}%`).all()).results||[];
  let paused=0,requeued=0;
  for(const row of rows){
    try{
      const response=await serveImageVariant(env,row.platform,row.public_token);
      if(response.ok){
        if(row.status==='paused'){
          await env.DB.prepare(`UPDATE scheduled_posts SET status='scheduled',error_message=NULL,updated_at=? WHERE id=? AND status='paused'`).bind(nowIso(),row.id).run();
          await resolveHealth(env,`media:post:${row.id}`);
          requeued++;
        }
        continue;
      }
      if(response.headers.get('x-ma-media-state')==='blocked'){
        const detail=(await response.text()).slice(0,700);
        await env.DB.prepare(`UPDATE scheduled_posts SET status='paused',error_message=?,updated_at=? WHERE id=?`).bind(`${MEDIA_RETRY_PREFIX} ${detail}`,nowIso(),row.id).run();
        await health(env,`media:post:${row.id}`,'red',`Post paused before publishing because safe media could not be produced. ${detail}`.slice(0,900));
        paused++;
      }
    }catch(e){
      await health(env,`media:preflight:${row.id}`,'yellow',`Media preflight could not complete; publishing was left unchanged for normal retry/error handling: ${String(e.message||e).slice(0,500)}`);
    }
  }
  return {checked:rows.length,paused,requeued};
}

async function approveWholeWeek(request,env){
  if(!assertSameOrigin(request,env))return json({error:'Origin rejected'},403);
  const user=await currentUser(env,request);
  if(!user)return json({error:'Authentication required'},401);
  if(user.role==='viewer')return json({error:'Viewer accounts are read-only'},403);
  let input={};try{input=await request.json()}catch{}
  const weekStart=String(input.week_start||'');
  if(!weekStart)return json({error:'week_start is required'},400);
  const campaign=await env.DB.prepare(`SELECT id FROM campaigns WHERE week_start=? ORDER BY generated_at DESC LIMIT 1`).bind(weekStart).first();
  if(!campaign)return json({error:'No campaign found for that week'},404);
  const t=nowIso();
  const result=await env.DB.prepare(`UPDATE scheduled_posts SET status='approved',updated_at=? WHERE campaign_id=? AND status IN ('scheduled','paused')`).bind(t,campaign.id).run();
  await env.DB.prepare(`UPDATE campaigns SET status='active' WHERE id=?`).bind(campaign.id).run();
  return json({ok:true,approved:Number(result.meta?.changes||0),campaign_id:campaign.id});
}

async function connectInstagram(request,env){
  if(!assertSameOrigin(request,env))return json({error:'Origin rejected'},403);
  const user=await currentUser(env,request);
  if(!user)return json({error:'Authentication required'},401);
  if(user.role==='viewer')return json({error:'Viewer accounts are read-only'},403);
  try{
    const result=await connectInstagramFromFacebook(env);
    await resolveHealth(env,'connect:instagram');
    return json({ok:true,...result});
  }catch(e){
    await health(env,'connect:instagram','yellow',String(e.message||e).slice(0,300));
    return json({error:String(e.message||e)},400);
  }
}

async function beginFacebookOAuth(request,env){
  const user=await currentUser(env,request);
  if(!user)return json({error:'Authentication required'},401);
  if(user.role==='viewer')return json({error:'Viewer accounts are read-only'},403);
  if(!env.META_APP_ID||!env.META_APP_SECRET)return json({error:'Facebook authorization is not configured yet. META_APP_ID and META_APP_SECRET are required.'},503);
  const origin=new URL(request.url).origin;
  const state=crypto.randomUUID();
  await setSetting(env,`oauth:facebook:${state}`,{created_at:nowIso(),user_id:user.id});
  const redirectUri=`${origin}/oauth/facebook/callback`;
  const params=new URLSearchParams({client_id:String(env.META_APP_ID),redirect_uri:redirectUri,state,response_type:'code',scope:'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish'});
  return json({ok:true,authorization_url:`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth?${params.toString()}`});
}

async function graphJson(url,opts,label){
  const r=await fetch(url,opts);const data=await r.json().catch(()=>({}));
  if(!r.ok||data?.error)throw new Error(`${label}: ${data?.error?.message||data?.message||`HTTP ${r.status}`}`);
  return data;
}

async function completeFacebookOAuth(request,env){
  const url=new URL(request.url);const state=url.searchParams.get('state')||'';const code=url.searchParams.get('code')||'';
  const externalError=url.searchParams.get('error_description')||url.searchParams.get('error');
  if(externalError)return oauthResultPage('Facebook',false,externalError);
  if(!state||!code)return oauthResultPage('Facebook',false,'Missing authorization response.');
  const marker=await setting(env,`oauth:facebook:${state}`,null);
  if(!marker)return oauthResultPage('Facebook',false,'This Facebook authorization request expired or was already used.');
  await setSetting(env,`oauth:facebook:${state}`,null);
  try{
    if(!env.META_APP_ID||!env.META_APP_SECRET)throw new Error('Facebook authorization is not configured.');
    const origin=url.origin;const redirectUri=`${origin}/oauth/facebook/callback`;
    const tokenParams=new URLSearchParams({client_id:String(env.META_APP_ID),client_secret:String(env.META_APP_SECRET),redirect_uri:redirectUri,code});
    const tokenData=await graphJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token?${tokenParams.toString()}`,{},'Facebook token exchange');
    const userToken=tokenData.access_token;if(!userToken)throw new Error('Facebook returned no access token.');
    const accounts=await graphJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`,{},'Facebook Pages');
    const page=(accounts.data||[]).find(p=>String(p.id)===TABLE_ROCK_PAGE_ID);
    if(!page?.access_token)throw new Error('Table Rock Press was not returned by Facebook. Make sure Table Rock Press is selected during authorization.');
    const enc=await encryptCredential(env,String(page.access_token));const t=nowIso();
    const existing=await env.DB.prepare(`SELECT id FROM connectors WHERE platform='facebook' AND connector_type='meta_facebook' AND json_extract(config_json,'$.page_id')=? ORDER BY priority ASC LIMIT 1`).bind(TABLE_ROCK_PAGE_ID).first();
    const cfg=JSON.stringify({page_id:TABLE_ROCK_PAGE_ID,api_version:META_GRAPH_VERSION});
    if(existing)await env.DB.prepare(`UPDATE connectors SET name='Table Rock Press Facebook',enabled=1,priority=10,cost_cents_per_post=0,config_json=?,secret_ciphertext=?,secret_iv=?,last_error_at=NULL,last_error=NULL,updated_at=? WHERE id=?`).bind(cfg,enc.ciphertext,enc.iv,t,existing.id).run();
    else await env.DB.prepare(`INSERT INTO connectors(id,name,connector_type,platform,enabled,priority,cost_cents_per_post,config_json,secret_ciphertext,secret_iv,created_at,updated_at) VALUES(?, 'Table Rock Press Facebook','meta_facebook','facebook',1,10,0,?,?,?,?,?)`).bind(`con_${crypto.randomUUID()}`,cfg,enc.ciphertext,enc.iv,t,t).run();
    await resolveHealth(env,'connect:facebook');
    try{await connectInstagramFromFacebook(env);await resolveHealth(env,'connect:instagram');}catch(e){await health(env,'connect:instagram','yellow',String(e.message||e).slice(0,300));}
    return oauthResultPage('Facebook',true,'Table Rock Press Facebook was reconnected. Marketing Autopilot also checked the linked Instagram account.');
  }catch(e){await health(env,'connect:facebook','yellow',String(e.message||e).slice(0,300));return oauthResultPage('Facebook',false,String(e.message||e));}
}

async function beginSocialOAuth(request,env,platform){
  const user=await currentUser(env,request);
  if(!user)return json({error:'Authentication required'},401);
  if(user.role==='viewer')return json({error:'Viewer accounts are read-only'},403);
  const origin=new URL(request.url).origin;
  try{
    const result=platform==='pinterest'?await beginPinterestOAuth(env,origin):await beginTikTokOAuth(env,origin);
    return json({ok:true,...result});
  }catch(e){
    await health(env,`connect:${platform}`,'yellow',String(e.message||e).slice(0,300));
    return json({error:String(e.message||e)},400);
  }
}

function oauthResultPage(platform,ok,message){
  const title=ok?`${platform} connected`:`${platform} connection failed`;
  const safe=String(message||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui;background:#111;color:#eee;padding:32px;max-width:680px;margin:auto}a{color:#9fd3ff}.card{background:#1c1c1c;padding:24px;border-radius:14px}</style><div class="card"><h1>${title}</h1><p>${safe}</p><p><a href="/">Return to Marketing Autopilot</a></p></div>`,{status:ok?200:400,headers:{'content-type':'text/html; charset=utf-8'}});
}

async function completeSocialOAuth(request,env,platform){
  const url=new URL(request.url);
  const externalError=url.searchParams.get('error_description')||url.searchParams.get('error');
  if(externalError){
    await health(env,`connect:${platform}`,'yellow',String(externalError).slice(0,300));
    return oauthResultPage(platform,false,externalError);
  }
  const state=url.searchParams.get('state')||''; const code=url.searchParams.get('code')||'';
  try{
    const origin=url.origin;
    const result=platform==='pinterest'
      ? await completePinterestOAuth(env,{origin,state,code})
      : await completeTikTokOAuth(env,{origin,state,code});
    await resolveHealth(env,`connect:${platform}`);
    const detail=platform==='pinterest'&&result.board_name?`Publishing board: ${result.board_name}.`:'Authorization saved securely.';
    return oauthResultPage(platform,true,detail);
  }catch(e){
    await health(env,`connect:${platform}`,'yellow',String(e.message||e).slice(0,300));
    return oauthResultPage(platform,false,String(e.message||e));
  }
}

async function prepareRuntime(env){
  await ensureSchema(env);
  await ensureSandboxConnectors(env);
  await ensureTableRockPressSeed(env);
}

async function baseFetchWithSaleAlert(request,env,ctx){
  const isPayhip=request.method==='POST'&&new URL(request.url).pathname==='/webhooks/payhip';
  const copy=isPayhip?request.clone():null;
  const response=await base.fetch(request,env,ctx);
  if(isPayhip&&response.ok&&copy){
    try{
      const payload=await copy.json();
      if(payload?.type==='paid')await notifyPaidSale(env,payload);
    }catch(e){
      await health(env,'notifications:sale','yellow',`Sale alert failed: ${String(e.message||e).slice(0,220)}`);
    }
  }
  return response;
}

export default {
  async fetch(request,env,ctx){
    await prepareRuntime(env);
    const url=new URL(request.url);
    if(url.pathname==='/api/week/approve'&&request.method==='POST')return approveWholeWeek(request,env);
    if(url.pathname==='/api/connectors/facebook/oauth/start'&&request.method==='GET')return beginFacebookOAuth(request,env);
    if(url.pathname==='/oauth/facebook/callback'&&request.method==='GET')return completeFacebookOAuth(request,env);
    if(url.pathname==='/api/connectors/instagram/from-facebook'&&request.method==='POST')return connectInstagram(request,env);
    if(url.pathname==='/api/connectors/pinterest/oauth/start'&&request.method==='GET')return beginSocialOAuth(request,env,'pinterest');
    if(url.pathname==='/api/connectors/tiktok/oauth/start'&&request.method==='GET')return beginSocialOAuth(request,env,'tiktok');
    if(url.pathname==='/oauth/pinterest/callback'&&request.method==='GET')return completeSocialOAuth(request,env,'pinterest');
    if(url.pathname==='/oauth/tiktok/callback'&&request.method==='GET')return completeSocialOAuth(request,env,'tiktok');
    if(url.pathname.startsWith('/media-variant/')&&request.method==='GET'){
      const parts=url.pathname.split('/').filter(Boolean);
      if(parts.length!==3)return new Response('Not found',{status:404});
      return serveImageVariant(env,decodeURIComponent(parts[1]),decodeURIComponent(parts[2]));
    }
    return baseFetchWithSaleAlert(request,env,ctx);
  },
  async scheduled(controller,env,ctx){
    await prepareRuntime(env);
    const leaseToken=await acquireSchedulerLease(env);
    if(!leaseToken)return;
    try{
      try{
        const refreshed=await refreshSocialOAuthConnectors(env);
        for(const r of refreshed.filter(x=>x.state==='failed'))await health(env,`oauth-refresh:${r.id}`,'yellow',String(r.error||'OAuth token refresh failed').slice(0,300));
      }catch(e){
        await health(env,'oauth-refresh','yellow',`Social token refresh sweep failed: ${String(e.message||e).slice(0,220)}`);
      }
      await preflightDueMedia(env);
      await base.scheduled(controller,env,ctx);
      try{
        await reconcileTikTokSubmissions(env);
        await resolveHealth(env,'tiktok:reconcile');
      }catch(e){
        await health(env,'tiktok:reconcile','yellow',`TikTok submission reconciliation failed: ${String(e.message||e).slice(0,220)}`);
      }
      try{
        const sales=await notifyRecordedPaidSales(env);
        if(sales.some(x=>x.state==='failed'))throw new Error(`${sales.filter(x=>x.state==='failed').length} recorded sale alert(s) failed and will retry`);
        await resolveHealth(env,'notifications:sale');
      }catch(e){
        await health(env,'notifications:sale','yellow',`Recorded sale alert sweep failed: ${String(e.message||e).slice(0,220)}`);
      }
      try{
        await notifyUnresolvedHealth(env);
        await resolveHealth(env,'notifications:health');
      }catch(e){
        await health(env,'notifications:health','yellow',`Health alert sweep failed: ${String(e.message||e).slice(0,220)}`);
      }
      if(controller.cron==='17 3 * * *'){
        try{
          await ensureAutopilotCampaigns(env);
          await resolveHealth(env,'autopilot:campaigns');
        }catch(e){
          await health(env,'autopilot:campaigns','yellow',`Autopilot campaign preparation failed: ${String(e.message||e).slice(0,220)}`);
        }
        try{
          await syncGoogleDrive(env);
        }catch(e){
        }
      }
    }finally{
      await releaseSchedulerLease(env,leaseToken);
    }
  }
};