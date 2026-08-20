import { nowIso } from './utils.js';
import { setting } from './db.js';
import { decryptCredential } from './security.js';

async function connectorSecret(env,c){ return c.secret_ciphertext ? decryptCredential(env,c.secret_ciphertext,c.secret_iv) : null; }
async function bufferPublish(env, connector, post, assetUrl) {
  const token=(await connectorSecret(env,connector))||env.BUFFER_API_KEY; if(!token) throw new Error('Buffer API key not configured');
  const cfg=JSON.parse(connector.config_json||'{}'); if(!cfg.channel_id) throw new Error(`Buffer channel_id missing for ${post.platform}`);
  const assetPart=assetUrl?`assets:[{image:{url:${JSON.stringify(assetUrl)}}}]`:'assets:[]';
  const query=`mutation CreatePost { createPost(input:{ text:${JSON.stringify(post.caption)}, channelId:${JSON.stringify(cfg.channel_id)}, schedulingType:automatic, mode:shareNow, ${assetPart}, aiAssisted:true, needsApproval:false }) { ... on PostActionSuccess { post { id dueAt } } ... on MutationError { message } } }`;
  const r=await fetch('https://api.buffer.com',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},body:JSON.stringify({query})}); const data=await r.json(); if(!r.ok||data.errors)throw new Error(`Buffer error: ${JSON.stringify(data.errors||data)}`); const payload=data?.data?.createPost;if(payload?.message)throw new Error(`Buffer: ${payload.message}`);const postId=payload?.post?.id;if(!postId)throw new Error('Buffer returned no post id');return {externalId:postId,state:'published'};
}
async function mailerLitePublish(env, connector, post) {
  const token=(await connectorSecret(env,connector))||env.MAILERLITE_API_KEY; if(!token) throw new Error('MailerLite API key not configured');
  const cfg=JSON.parse(connector.config_json||'{}'); if(!cfg.from||!cfg.from_name||!cfg.group_id)throw new Error('MailerLite connector requires from, from_name, and group_id');
  if(!cfg.html_template) throw new Error('MailerLite API route needs an approved HTML template/content-capable plan; configure html_template or use an existing automation route.');
  const headers={'content-type':'application/json','accept':'application/json','authorization':`Bearer ${token}`}; const html=cfg.html_template.replace('{{CONTENT}}',post.caption.replaceAll('\n','<br>'));
  const create=await fetch('https://connect.mailerlite.com/api/campaigns',{method:'POST',headers,body:JSON.stringify({name:`Marketing Autopilot ${post.scheduled_for.slice(0,10)}`,type:'regular',groups:[cfg.group_id],emails:[{subject:cfg.subject_prefix?`${cfg.subject_prefix} ${post.product_name||''}`:(post.product_name||'News'),from_name:cfg.from_name,from:cfg.from,content:html}]})}); const created=await create.json(); if(!create.ok)throw new Error(`MailerLite create ${create.status}: ${JSON.stringify(created)}`); const campaignId=created?.data?.id;if(!campaignId)throw new Error('MailerLite returned no campaign id');
  const schedule=await fetch(`https://connect.mailerlite.com/api/campaigns/${campaignId}/schedule`,{method:'POST',headers,body:JSON.stringify({delivery:'instant'})});const scheduled=await schedule.json();if(!schedule.ok)throw new Error(`MailerLite send ${schedule.status}: ${JSON.stringify(scheduled)}`);return {externalId:campaignId,state:'published'};
}

async function metaFacebookPublish(env,connector,post,assetUrl){
  const token=(await connectorSecret(env,connector)); if(!token) throw new Error('Meta access token not configured');
  const cfg=JSON.parse(connector.config_json||'{}'); if(!cfg.page_id) throw new Error('Meta Facebook connector requires page_id');
  const version=cfg.api_version||'v25.0'; const host=cfg.host||'https://graph.facebook.com';
  const endpoint=assetUrl?`${host}/${version}/${cfg.page_id}/photos`:`${host}/${version}/${cfg.page_id}/feed`;
  const form=new URLSearchParams(); form.set(assetUrl?'caption':'message',post.caption); if(assetUrl){form.set('url',assetUrl);form.set('published','true');} form.set('access_token',token);
  const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form}); const data=await r.json(); if(!r.ok||data.error) throw new Error(`Meta Facebook ${r.status}: ${data.error?.message||JSON.stringify(data)}`); const externalId=data.post_id||data.id; if(!externalId)throw new Error('Meta Facebook returned no post id'); return {externalId,state:'published'};
}
async function metaInstagramPublish(env,connector,post,assetUrl){
  const token=(await connectorSecret(env,connector)); if(!token) throw new Error('Instagram access token not configured'); const cfg=JSON.parse(connector.config_json||'{}'); if(!cfg.ig_user_id)throw new Error('Meta Instagram connector requires ig_user_id'); if(!assetUrl)throw new Error('Instagram image post requires an approved graphic'); if(post.mime_type && post.mime_type!=='image/jpeg')throw new Error(`Direct Instagram publishing requires JPEG; asset is ${post.mime_type}. Trying another route.`);
  const version=cfg.api_version||'v25.0'; const host=cfg.host||'https://graph.facebook.com'; const form=new URLSearchParams({image_url:assetUrl,caption:post.caption,access_token:token}); const create=await fetch(`${host}/${version}/${cfg.ig_user_id}/media`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form}); const c=await create.json(); if(!create.ok||c.error)throw new Error(`Instagram create ${create.status}: ${c.error?.message||JSON.stringify(c)}`); if(!c.id)throw new Error('Instagram returned no media container id'); const pubForm=new URLSearchParams({creation_id:c.id,access_token:token}); const pub=await fetch(`${host}/${version}/${cfg.ig_user_id}/media_publish`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:pubForm}); const data=await pub.json(); if(!pub.ok||data.error)throw new Error(`Instagram publish ${pub.status}: ${data.error?.message||JSON.stringify(data)}`); if(!data.id)throw new Error('Instagram returned no published media id'); return {externalId:data.id,state:'published'};
}
async function pinterestPublish(env,connector,post,assetUrl,origin){
  const token=(await connectorSecret(env,connector)); if(!token)throw new Error('Pinterest access token not configured'); const cfg=JSON.parse(connector.config_json||'{}'); if(!cfg.board_id)throw new Error('Pinterest connector requires board_id'); if(!assetUrl)throw new Error('Pinterest image Pin requires an approved graphic');
  const link=post.tracking_code?`${origin}/r/${post.tracking_code}`:undefined; const body={board_id:String(cfg.board_id),title:String(post.product_name||'').slice(0,100)||undefined,description:String(post.caption||'').slice(0,800),link,media_source:{source_type:'image_url',url:assetUrl,is_standard:true}};
  const r=await fetch('https://api.pinterest.com/v5/pins',{method:'POST',headers:{'content-type':'application/json','accept':'application/json','authorization':`Bearer ${token}`},body:JSON.stringify(body)}); const data=await r.json(); if(!r.ok)throw new Error(`Pinterest ${r.status}: ${data.message||JSON.stringify(data)}`); if(!data.id)throw new Error('Pinterest returned no Pin id'); return {externalId:data.id,state:'published'};
}

async function sandboxPublish(_env,_connector,post){return {externalId:`sandbox_${post.id}`,state:'simulated'};}
async function runConnector(env,c,post,assetUrl,origin){if(c.connector_type==='buffer')return bufferPublish(env,c,post,assetUrl);if(c.connector_type==='meta_facebook')return metaFacebookPublish(env,c,post,assetUrl);if(c.connector_type==='meta_instagram')return metaInstagramPublish(env,c,post,assetUrl);if(c.connector_type==='pinterest')return pinterestPublish(env,c,post,assetUrl,origin);if(c.connector_type==='mailerlite')return mailerLitePublish(env,c,post);if(c.connector_type==='sandbox')return sandboxPublish(env,c,post);throw new Error(`Unsupported connector type: ${c.connector_type}`);}
export async function eligibleConnectors(env,platform){
  const ctl=await setting(env,'cost_control',{approved_monthly_cost_cents:0});const usedRow=await env.DB.prepare(`SELECT COALESCE(SUM(amount_cents),0) used FROM cost_usage WHERE period=strftime('%Y-%m','now')`).first();const remaining=Number(ctl.approved_monthly_cost_cents||0)-Number(usedRow?.used||0);const rows=(await env.DB.prepare(`SELECT * FROM connectors WHERE platform=? AND enabled=1 ORDER BY priority ASC,cost_cents_per_post ASC`).bind(platform).all()).results||[];return rows.filter(c=>Number(c.cost_cents_per_post||0)<=Math.max(0,remaining));
}
export async function publishOne(env,post){
  const connectors=await eligibleConnectors(env,post.platform);if(!connectors.length)throw new Error(`No enabled connector within approved cost ceiling for ${post.platform}`);const runtime=await setting(env,'runtime_origin',{origin:env.APP_ORIGIN}); const origin=runtime.origin||env.APP_ORIGIN; const assetUrl=post.public_token?`${origin}/public-media/${post.public_token}`:null;const attempts=[];
  for(const c of connectors){try{const result=await runConnector(env,c,post,assetUrl,origin);await env.DB.prepare(`UPDATE connectors SET last_success_at=?,last_error=NULL,updated_at=? WHERE id=?`).bind(nowIso(),nowIso(),c.id).run();if(Number(c.cost_cents_per_post||0)>0)await env.DB.prepare(`INSERT INTO cost_usage(id,category,provider,amount_cents,units,period,recorded_at) VALUES(?,?,?,?,1,strftime('%Y-%m','now'),?)`).bind(`cost_${crypto.randomUUID()}`,'publishing',c.connector_type,c.cost_cents_per_post,nowIso()).run();return {...result,connector:c,attempts};}catch(e){attempts.push({connector:c.name,error:String(e.message||e)});await env.DB.prepare(`UPDATE connectors SET last_error_at=?,last_error=?,updated_at=? WHERE id=?`).bind(nowIso(),String(e.message||e).slice(0,1000),nowIso(),c.id).run();}}
  throw new Error(`All ${post.platform} routes failed: ${attempts.map(a=>`${a.connector}: ${a.error}`).join(' | ')}`);
}

export async function syncBufferMetrics(env){
  const rows=(await env.DB.prepare(`SELECT sp.id,sp.external_post_id,sp.platform,sp.connector_id,c.secret_ciphertext,c.secret_iv FROM scheduled_posts sp LEFT JOIN connectors c ON c.id=sp.connector_id WHERE sp.connector_type='buffer' AND sp.status='published' AND sp.external_post_id IS NOT NULL AND sp.published_at>=datetime('now','-30 days') ORDER BY sp.published_at DESC LIMIT 100`).all()).results||[];
  let synced=0;
  for(const row of rows){
    try{
      const token=(row.secret_ciphertext?await decryptCredential(env,row.secret_ciphertext,row.secret_iv):null)||env.BUFFER_API_KEY; if(!token) continue;
      const query=`query GetPostMetrics { post(input:{id:${JSON.stringify(row.external_post_id)}}){ id metrics { type name value unit } metricsUpdatedAt } }`;
      const r=await fetch('https://api.buffer.com',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},body:JSON.stringify({query})}); const data=await r.json(); if(!r.ok||data.errors)throw new Error(JSON.stringify(data.errors||data));
      const metrics=data?.data?.post?.metrics||[]; const byType=Object.fromEntries(metrics.map(m=>[String(m.type||m.name||'').toLowerCase(),Number(m.value||0)]));
      const impressions=byType.impressions||0, reach=byType.reach||0, clicks=byType.clicks||byType.linkclicks||0;
      const engagements=byType.engagements||byType.engagement||((byType.reactions||0)+(byType.comments||0)+(byType.shares||0));
      await env.DB.prepare(`INSERT INTO metrics(id,post_id,platform,source,impressions,reach,engagements,clicks,landing_visits,conversions,revenue_cents,captured_at) VALUES(?,?,?,?,?,?,?,?,0,0,0,?) ON CONFLICT(post_id,source) DO UPDATE SET impressions=excluded.impressions,reach=excluded.reach,engagements=excluded.engagements,clicks=excluded.clicks,captured_at=excluded.captured_at`).bind(`met_buffer_${row.id}`,row.id,row.platform,'buffer',impressions,reach,engagements,clicks,nowIso()).run(); synced++;
    }catch(e){await env.DB.prepare(`UPDATE connectors SET last_error_at=?,last_error=?,updated_at=? WHERE id=?`).bind(nowIso(),`Metrics sync: ${String(e.message||e).slice(0,800)}`,nowIso(),row.connector_id).run();}
  }
  return synced;
}
