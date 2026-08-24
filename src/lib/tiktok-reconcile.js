import { decryptCredential } from './security.js';
import { audit, health, resolveHealth } from './db.js';
import { fetchTikTokPostStatus } from './tiktok-direct.js';
import { nowIso } from './utils.js';

export function classifyTikTokOutcome(data={}){
  const status=String(data?.status||'').toUpperCase();
  if(status==='PUBLISH_COMPLETE') return {state:'published',reason:null};
  if(status==='FAILED') return {state:'failed',reason:String(data?.fail_reason||'TikTok processing failed')};
  return {state:'pending',reason:null};
}

async function adjustUsage(env,row,delta){
  if(!delta)return;
  if(row.asset_id) await env.DB.prepare(`UPDATE assets SET use_count=MAX(0,use_count+?),updated_at=? WHERE id=?`).bind(delta,nowIso(),row.asset_id).run();
  if(row.copy_id) await env.DB.prepare(`UPDATE copy_items SET use_count=MAX(0,use_count+?),updated_at=? WHERE id=?`).bind(delta,nowIso(),row.copy_id).run();
}

export async function reconcileTikTokSubmissions(env){
  const rows=(await env.DB.prepare(`SELECT sp.id,sp.status,sp.external_post_id,sp.asset_id,sp.copy_id,sp.connector_id,
      c.secret_ciphertext,c.secret_iv
    FROM scheduled_posts sp
    JOIN connectors c ON c.id=sp.connector_id
    WHERE sp.connector_type='tiktok'
      AND sp.external_post_id IS NOT NULL
      AND sp.status IN ('published','submitted')
      AND instr(sp.external_post_id,'~')>0
    ORDER BY sp.updated_at ASC
    LIMIT 25`).all()).results||[];

  let checked=0,published=0,failed=0,pending=0;
  for(const row of rows){
    checked++;
    try{
      const token=row.secret_ciphertext?await decryptCredential(env,row.secret_ciphertext,row.secret_iv):null;
      if(!token) throw new Error('TikTok access token not configured');
      const data=await fetchTikTokPostStatus(token,row.external_post_id);
      const outcome=classifyTikTokOutcome(data);

      if(outcome.state==='published'){
        if(row.status==='submitted') await adjustUsage(env,row,1);
        const publicId=Array.isArray(data?.publicaly_available_post_id)&&data.publicaly_available_post_id.length
          ?String(data.publicaly_available_post_id[0]):row.external_post_id;
        await env.DB.prepare(`UPDATE scheduled_posts SET status='published',external_post_id=?,published_at=COALESCE(published_at,?),error_message=NULL,updated_at=? WHERE id=?`)
          .bind(publicId,nowIso(),nowIso(),row.id).run();
        await resolveHealth(env,`publish:tiktok:${row.id}`);
        await audit(env,{type:'post.published.confirmed',entityType:'scheduled_post',entityId:row.id,summary:'TikTok confirmed the post as published'});
        published++;
        continue;
      }

      if(outcome.state==='failed'){
        if(row.status==='published') await adjustUsage(env,row,-1);
        await env.DB.prepare(`UPDATE scheduled_posts SET status='failed',published_at=NULL,error_message=?,updated_at=? WHERE id=?`)
          .bind(`TikTok processing failed: ${outcome.reason}`.slice(0,1000),nowIso(),row.id).run();
        await health(env,`publish:tiktok:${row.id}`,'red',`TikTok rejected a submitted post: ${outcome.reason}`.slice(0,900));
        await audit(env,{type:'post.failed.confirmed',entityType:'scheduled_post',entityId:row.id,summary:'TikTok reported a submitted post failed',data:{reason:outcome.reason}});
        failed++;
        continue;
      }

      if(row.status==='published'){
        await adjustUsage(env,row,-1);
        await env.DB.prepare(`UPDATE scheduled_posts SET status='submitted',published_at=NULL,error_message=NULL,updated_at=? WHERE id=?`).bind(nowIso(),row.id).run();
      }
      pending++;
    }catch(e){
      await health(env,`publish:tiktok:${row.id}`,'yellow',`TikTok submission status check failed; the post will be checked again: ${String(e.message||e).slice(0,700)}`);
    }
  }
  return {checked,published,failed,pending};
}
