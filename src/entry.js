import base from './index.js';
import { ensureAutopilotCampaigns } from './lib/autopilot-maintenance.js';
import { health, resolveHealth } from './lib/db.js';
import { ensureSchema } from './lib/schema-bootstrap.js';
import { ensureSandboxConnectors } from './lib/sandbox.js';
import { ensureTableRockPressSeed } from './lib/table-rock-seed.js';
import { currentUser } from './lib/auth.js';
import { assertSameOrigin } from './lib/security.js';
import { nowIso } from './lib/utils.js';
import { notifyPaidSale, notifyRecordedPaidSales, notifyUnresolvedHealth } from './lib/notifications.js';
import { serveImageVariant } from './lib/media-normalization.js';
import { syncGoogleDrive } from './lib/google-drive-sync.js';
import { reconcileTikTokSubmissions } from './lib/tiktok-reconcile.js';
import { connectInstagramFromFacebook } from './lib/instagram-connect.js';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8'}});
const SCHEDULER_LEASE_KEY='scheduler:lease';
const SCHEDULER_LEASE_MS=10*60*1000;
const MEDIA_RETRY_PREFIX='MEDIA_BLOCKED_RETRY:';

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
      if(response.status===415&&response.headers.get('x-ma-media-state')==='blocked'){
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
    if(url.pathname==='/api/connectors/instagram/from-facebook'&&request.method==='POST')return connectInstagram(request,env);
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
          // syncGoogleDrive records a Needs Attention event; keep the rest of maintenance running.
        }
      }
    }finally{
      await releaseSchedulerLease(env,leaseToken);
    }
  }
};