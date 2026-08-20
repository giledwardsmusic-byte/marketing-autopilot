import { json, bodyJson, id, nowIso, parseJSON, sha256Hex, startOfWeekISO, endOfWeekISO, safeUrl } from './lib/utils.js';
import { assertSameOrigin, encryptCredential } from './lib/security.js';
import { authStatus, bootstrap, login, logout, currentUser, createUser } from './lib/auth.js';
import { audit, health, resolveHealth, setting, setSetting } from './lib/db.js';
import { generatePlan, buildCaption, adaptPostingPolicy } from './lib/campaign-engine.js';
import { generateCopy, classifyAsset } from './lib/ai.js';
import { publishOne, syncBufferMetrics } from './lib/publishers.js';

const CORS_HEADERS={};
const unauth=()=>json({error:'Authentication required'},401);
const fail=(e,status=400)=>json({error:e?.message||String(e)},status);

async function requireUser(env,request){ return await currentUser(env,request); }

async function productsList(env){
  const rows=(await env.DB.prepare(`SELECT p.*, (SELECT COUNT(*) FROM assets a WHERE a.product_id=p.id) asset_count, (SELECT COUNT(*) FROM copy_items c WHERE c.product_id=p.id) copy_count FROM products p ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, p.updated_at DESC`).all()).results||[];
  return rows.map(r=>({...r,features:parseJSON(r.features_json,[]),benefits:parseJSON(r.benefits_json,[])}));
}

async function dashboard(env){
  const [products,posts,healthRows,costs,metrics,needs]=await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) total, SUM(status='active') active FROM products`).first(),
    env.DB.prepare(`SELECT COUNT(*) scheduled, SUM(status='published') published FROM scheduled_posts WHERE scheduled_for>=datetime('now','-7 days')`).first(),
    env.DB.prepare(`SELECT * FROM health_events WHERE resolved=0 ORDER BY CASE severity WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END,created_at DESC LIMIT 20`).all(),
    env.DB.prepare(`SELECT COALESCE(SUM(amount_cents),0) cents FROM cost_usage WHERE period=strftime('%Y-%m','now')`).first(),
    env.DB.prepare(`SELECT COALESCE(SUM(impressions),0) impressions,COALESCE(SUM(clicks),0) clicks,COALESCE(SUM(conversions),0) conversions,COALESCE(SUM(revenue_cents),0) revenue_cents FROM (SELECT post_id,MAX(impressions) impressions,MAX(clicks) clicks,MAX(conversions) conversions,MAX(revenue_cents) revenue_cents FROM metrics WHERE captured_at>=datetime('now','-30 days') GROUP BY post_id)`).first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM scheduled_posts WHERE status='failed'`).first()
  ]);
  const sales=await env.DB.prepare(`SELECT COALESCE(SUM(amount_cents),0) revenue_cents, SUM(CASE WHEN event_type='paid' THEN 1 ELSE 0 END) sales_count FROM sales_events WHERE occurred_at>=datetime('now','-30 days')`).first();
  metrics.revenue_cents=Number(metrics.revenue_cents||0)+Number(sales?.revenue_cents||0); metrics.conversions=Math.max(Number(metrics.conversions||0),Number(sales?.sales_count||0));
  const ctl=await setting(env,'cost_control',{approved_monthly_cost_cents:0});
  return {products,posts,health:healthRows.results||[],monthly_cost_cents:Number(costs?.cents||0),metrics,needs_attention:Number(needs?.n||0),cost_ceiling_cents:Number(ctl.approved_monthly_cost_cents||0)};
}

async function generateWeek(env,user,request){
  const input=await bodyJson(request); const requestOrigin=new URL(request.url).origin; await setSetting(env,'runtime_origin',{origin:requestOrigin}); const start=input.week_start?new Date(input.week_start).toISOString():startOfWeekISO(new Date(Date.now()+7*86400_000)); const end=endOfWeekISO(start);
  const existing=await env.DB.prepare(`SELECT id FROM campaigns WHERE week_start=? AND status IN ('planned','active')`).bind(start).first();
  if(existing) return {campaign_id:existing.id,reused:true};
  const products=await productsList(env);
  const assets=((await env.DB.prepare(`SELECT * FROM assets WHERE status IN ('approved','experimental')`).all()).results||[]).map(a=>({...a,platforms_json:parseJSON(a.platforms_json,[])}));
  const copyItems=(await env.DB.prepare(`SELECT * FROM copy_items WHERE status IN ('approved','experimental')`).all()).results||[];
  const statsRows=(await env.DB.prepare(`SELECT sp.product_id,SUM(mm.impressions) impressions,SUM(mm.clicks) clicks,SUM(mm.conversions) conversions,SUM(mm.revenue_cents) revenue_cents FROM (SELECT post_id,MAX(impressions) impressions,MAX(clicks) clicks,MAX(conversions) conversions,MAX(revenue_cents) revenue_cents FROM metrics WHERE captured_at>=datetime('now','-90 days') GROUP BY post_id) mm JOIN scheduled_posts sp ON sp.id=mm.post_id GROUP BY sp.product_id`).all()).results||[];
  const saleRows=(await env.DB.prepare(`SELECT product_id,SUM(amount_cents) revenue_cents,SUM(CASE WHEN event_type='paid' THEN 1 ELSE 0 END) conversions FROM sales_events WHERE occurred_at>=datetime('now','-90 days') GROUP BY product_id`).all()).results||[];
  const stats=Object.fromEntries(statsRows.map(r=>[r.product_id,{...r}])); for(const r of saleRows){stats[r.product_id]=stats[r.product_id]||{impressions:0,clicks:0,conversions:0,revenue_cents:0};stats[r.product_id].revenue_cents=Number(stats[r.product_id].revenue_cents||0)+Number(r.revenue_cents||0);stats[r.product_id].conversions=Math.max(Number(stats[r.product_id].conversions||0),Number(r.conversions||0));}
  const policy=await setting(env,'posting_policy',{}), autopilot=await setting(env,'autopilot',{}), tz=await setting(env,'marketing_timezone',{iana:'UTC'});
  const campaignId=id('camp');
  await env.DB.prepare(`INSERT INTO campaigns(id,name,week_start,week_end,status,autopilot,generated_at,generated_by) VALUES(?,?,?,?, 'planned',?,?,?)`).bind(campaignId,`Week of ${start.slice(0,10)}`,start,end,autopilot.enabled===false?0:1,nowIso(),'engine').run();
  const plan=generatePlan({products,assets,copyItems,stats,postingPolicy:policy,startISO:start,origin:requestOrigin,experimentalShare:autopilot.experimental_share||0.12,timeZone:tz.iana||'UTC'});
  for(const item of plan){
    let caption=buildCaption(item.product,item.copyItem,item.trackingUrl);
    if(!item.copyItem){
      try { caption=await generateCopy(env,item.product,{platform:item.platform,purpose:'sale',assetMessage:item.asset?.main_message||''}); } catch {}
      if(item.trackingUrl && !caption.includes(item.trackingUrl)) caption+=`\n\n${item.trackingUrl}`;
    }
    await env.DB.prepare(`INSERT INTO scheduled_posts(id,campaign_id,product_id,asset_id,copy_id,platform,caption,scheduled_for,status,approval_mode,tracking_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id('post'),campaignId,item.product.id,item.asset?.id||null,item.copyItem?.id||null,item.platform,caption,item.scheduled_for,'scheduled','autopilot',item.trackingCode,nowIso(),nowIso()).run();
  }
  await audit(env,{userId:user.id,type:'campaign.generated',entityType:'campaign',entityId:campaignId,summary:`Generated ${plan.length} scheduled items for ${start.slice(0,10)}`});
  return {campaign_id:campaignId,count:plan.length};
}

async function publishDue(env){
  const rows=(await env.DB.prepare(`SELECT sp.*,p.name product_name,a.public_token,a.mime_type FROM scheduled_posts sp LEFT JOIN products p ON p.id=sp.product_id LEFT JOIN assets a ON a.id=sp.asset_id WHERE sp.status IN ('scheduled','approved') AND sp.scheduled_for<=? ORDER BY sp.scheduled_for ASC LIMIT 25`).bind(nowIso()).all()).results||[];
  for(const post of rows){
    try{
      await env.DB.prepare(`UPDATE scheduled_posts SET status='publishing',updated_at=? WHERE id=?`).bind(nowIso(),post.id).run();
      const result=await publishOne(env,post); const finalStatus=result.state==='simulated'?'simulated':'published';
      await env.DB.prepare(`UPDATE scheduled_posts SET status=?,connector_type=?,connector_id=?,external_post_id=?,published_at=?,updated_at=?,error_message=NULL WHERE id=?`).bind(finalStatus,result.connector.connector_type,result.connector.id,result.externalId,nowIso(),nowIso(),post.id).run();
      if(result.attempts?.length) await audit(env,{type:'publishing.route_switched',entityType:'scheduled_post',entityId:post.id,summary:`${post.platform} automatically switched route after ${result.attempts.length} failed attempt(s)`,data:{attempts:result.attempts,used:result.connector.name}});
      if(finalStatus==='published' && post.asset_id) await env.DB.prepare(`UPDATE assets SET use_count=use_count+1,last_used_at=?,updated_at=? WHERE id=?`).bind(nowIso(),nowIso(),post.asset_id).run();
      if(finalStatus==='published' && post.copy_id) await env.DB.prepare(`UPDATE copy_items SET use_count=use_count+1,last_used_at=?,updated_at=? WHERE id=?`).bind(nowIso(),nowIso(),post.copy_id).run();
      await resolveHealth(env,`publish:${post.platform}`);
      await audit(env,{type:'post.published',entityType:'scheduled_post',entityId:post.id,summary:`${finalStatus==='simulated'?'Simulated':'Published'} ${post.platform} via ${result.connector.connector_type}`});
    }catch(e){
      await env.DB.prepare(`UPDATE scheduled_posts SET status='failed',error_message=?,updated_at=? WHERE id=?`).bind(String(e.message||e).slice(0,1000),nowIso(),post.id).run();
      await health(env,`publish:${post.platform}`,'yellow',String(e.message||e).slice(0,300));
      await audit(env,{type:'post.failed',entityType:'scheduled_post',entityId:post.id,summary:`${post.platform} publish failed`,data:{error:String(e.message||e)}});
    }
  }
  return rows.length;
}

async function backupMetadata(env){
  const tables=['products','assets','copy_items','campaigns','scheduled_posts','connectors','metrics','audit_events','settings','users']; const snapshot={created_at:nowIso(),schema:'v1',tables:{}};
  for(const table of tables){ snapshot.tables[table]=(await env.DB.prepare(`SELECT * FROM ${table} LIMIT 50000`).all()).results||[]; }
  const day=nowIso().slice(0,10); await env.MEDIA.put(`backups/${day}/metadata.json`,JSON.stringify(snapshot),{httpMetadata:{contentType:'application/json'}});
  return day;
}

async function linkReachable(url){
  try{let r=await fetch(url,{method:'HEAD',redirect:'follow'}); if([405,403].includes(r.status))r=await fetch(url,{method:'GET',headers:{range:'bytes=0-0'},redirect:'follow'}); return r.status<400;}catch{return false;}
}

async function nightly(env){
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at<=?`).bind(nowIso()).run();
  const products=(await env.DB.prepare(`SELECT id,name,sales_url,status,link_failures FROM products WHERE status='active' AND sales_url IS NOT NULL`).all()).results||[];
  for(const p of products.slice(0,50)){
    const ok=await linkReachable(p.sales_url);
    if(ok){ if(Number(p.link_failures||0)>0) await env.DB.prepare(`UPDATE products SET link_failures=0,updated_at=? WHERE id=?`).bind(nowIso(),p.id).run(); await resolveHealth(env,`link:${p.id}`); }
    else { const failures=Number(p.link_failures||0)+1; if(failures>=2){await env.DB.prepare(`UPDATE products SET status='paused',link_failures=?,updated_at=? WHERE id=?`).bind(failures,nowIso(),p.id).run();await health(env,`link:${p.id}`,'red',`${p.name} paused after repeated sales URL failures.`);await audit(env,{type:'product.auto_paused',entityType:'product',entityId:p.id,summary:`${p.name} paused after repeated broken-link checks`});}else{await env.DB.prepare(`UPDATE products SET link_failures=?,updated_at=? WHERE id=?`).bind(failures,nowIso(),p.id).run();await health(env,`link:${p.id}`,'yellow',`${p.name} sales URL failed one check; it will be verified again before pausing.`);}}
  }
  try{const n=await syncBufferMetrics(env); if(n) await audit(env,{type:'metrics.synced',summary:`Synced Buffer metrics for ${n} posts`});}catch(e){await health(env,'metrics:buffer','yellow',`Buffer metrics sync failed: ${String(e.message||e).slice(0,240)}`);}
  const aggregateRows=(await env.DB.prepare(`SELECT platform,SUM(impressions) impressions,SUM(clicks) clicks,SUM(conversions) conversions FROM (SELECT post_id,platform,MAX(impressions) impressions,MAX(clicks) clicks,MAX(conversions) conversions FROM metrics WHERE captured_at>=datetime('now','-30 days') GROUP BY post_id,platform) GROUP BY platform`).all()).results||[];
  const aggregate=Object.fromEntries(aggregateRows.map(r=>[r.platform,r]));
  const policy=await setting(env,'posting_policy',{}), optimization=await setting(env,'optimization',{}); const adapted=adaptPostingPolicy(policy,aggregate,optimization);
  if(JSON.stringify(adapted)!==JSON.stringify(policy)){await setSetting(env,'posting_policy',adapted);await audit(env,{type:'policy.adjusted',summary:'Posting policy automatically adjusted from recent performance'});}
  try{const day=await backupMetadata(env);await resolveHealth(env,'backup');await audit(env,{type:'backup.created',summary:`Daily metadata backup created for ${day}`});}catch(e){await health(env,'backup','yellow',`Backup failed: ${String(e.message||e).slice(0,240)}`);}
  return {ok:true};
}

async function handlePayhipWebhook(env,request){
  if(!env.PAYHIP_API_KEY) return json({error:'Payhip webhook is not configured'},503);
  const payload=await bodyJson(request); const expected=await sha256Hex(env.PAYHIP_API_KEY);
  if(!payload.signature || payload.signature!==expected) return json({error:'Invalid webhook signature'},401);
  if(!['paid','refunded'].includes(payload.type)) return json({ok:true,ignored:true});
  const tx=String(payload.id||''); if(!tx) return json({error:'Missing transaction id'},400);
  const tracking=payload.metadata?.ma_tracking||payload.metadata?.marketing_autopilot||null;
  const trackedPost=tracking?await env.DB.prepare(`SELECT id,product_id,platform FROM scheduled_posts WHERE tracking_code=?`).bind(tracking).first():null;
  const items=Array.isArray(payload.items)&&payload.items.length?payload.items:[{}]; const rawAmount=payload.type==='refunded'?Number(payload.amount_refunded||0):Number(payload.price||0); const sign=payload.type==='refunded'?-1:1; const perItem=Math.round((rawAmount/items.length))*sign; let inserted=0;
  for(const item of items){
    let product=null;
    if(trackedPost?.product_id) product=await env.DB.prepare(`SELECT id,name FROM products WHERE id=?`).bind(trackedPost.product_id).first();
    if(!product && item.product_permalink) product=await env.DB.prepare(`SELECT id,name FROM products WHERE sales_url=? LIMIT 1`).bind(item.product_permalink).first();
    if(!product && item.product_key) product=await env.DB.prepare(`SELECT id,name FROM products WHERE sales_url LIKE ? LIMIT 1`).bind(`%/b/${item.product_key}%`).first();
    if(!product && item.product_name) product=await env.DB.prepare(`SELECT id,name FROM products WHERE lower(name)=lower(?) LIMIT 1`).bind(item.product_name).first();
    const sid=id('sale'); const result=await env.DB.prepare(`INSERT OR IGNORE INTO sales_events(id,provider,transaction_id,product_id,post_id,tracking_code,event_type,amount_cents,currency,occurred_at,raw_summary_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(sid,'payhip',tx,product?.id||null,trackedPost?.id||null,tracking,payload.type,perItem,payload.currency||null,new Date((payload.date||payload.date_refunded||Date.now()/1000)*1000).toISOString(),JSON.stringify({product_name:item.product_name||null,product_key:item.product_key||null,allocated_across_items:items.length>1}),nowIso()).run();
    if(result.meta?.changes) inserted++;
  }
  if(trackedPost && inserted){
    const delta=payload.type==='paid'?1:-1;
    await env.DB.prepare(`INSERT INTO metrics(id,post_id,platform,source,conversions,captured_at) VALUES(?,?,?,?,?,?) ON CONFLICT(post_id,source) DO UPDATE SET conversions=MAX(0,conversions+?),captured_at=excluded.captured_at`).bind(`met_payhip_${trackedPost.id}`,trackedPost.id,trackedPost.platform,'payhip',Math.max(0,delta),nowIso(),delta).run();
  }
  if(inserted) await audit(env,{type:`sale.${payload.type}`,entityType:'sale',entityId:tx,summary:`Payhip ${payload.type} recorded`,data:{transaction_id:tx,items:items.length,tracking:tracking||null}});
  return json({ok:true,recorded:inserted});
}

async function api(env,request,user,url){
  const p=url.pathname, method=request.method; if(user.role==='viewer' && !['GET','HEAD'].includes(method)) return json({error:'Viewer accounts are read-only'},403);
  if(p==='/api/dashboard'&&method==='GET') return json(await dashboard(env));
  if(p==='/api/products'&&method==='GET') return json(await productsList(env));
  if(p==='/api/products'&&method==='POST'){
    const x=await bodyJson(request); if(!x.name) return fail(new Error('Product name required'));
    const pid=id('prd'), t=nowIso();
    await env.DB.prepare(`INSERT INTO products(id,name,product_type,brand,short_description,full_description,audience,features_json,benefits_json,price_cents,currency,sales_url,freebie_url,launch_date,status,manual_priority,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(pid,x.name,x.product_type||'digital',x.brand||null,x.short_description||null,x.full_description||null,x.audience||null,JSON.stringify(x.features||[]),JSON.stringify(x.benefits||[]),x.price_cents??null,x.currency||'USD',safeUrl(x.sales_url),safeUrl(x.freebie_url),x.launch_date||null,x.status||'active',Number(x.manual_priority||1),t,t).run();
    await audit(env,{userId:user.id,type:'product.created',entityType:'product',entityId:pid,summary:`Created product ${x.name}`}); return json({id:pid},201);
  }
  const productMatch=p.match(/^\/api\/products\/([^/]+)$/);
  if(productMatch&&method==='PATCH'){
    const pid=productMatch[1], x=await bodyJson(request); const allowed=['name','product_type','brand','short_description','full_description','audience','price_cents','currency','sales_url','freebie_url','launch_date','status','manual_priority'];
    const sets=[],vals=[]; for(const k of allowed) if(k in x){sets.push(`${k}=?`); vals.push(['sales_url','freebie_url'].includes(k)?safeUrl(x[k]):x[k]);}
    if('features' in x){sets.push('features_json=?');vals.push(JSON.stringify(x.features||[]));} if('benefits' in x){sets.push('benefits_json=?');vals.push(JSON.stringify(x.benefits||[]));}
    if(!sets.length)return json({ok:true}); sets.push('updated_at=?');vals.push(nowIso(),pid); await env.DB.prepare(`UPDATE products SET ${sets.join(',')} WHERE id=?`).bind(...vals).run(); await audit(env,{userId:user.id,type:'product.updated',entityType:'product',entityId:pid,summary:'Product updated'}); return json({ok:true});
  }
  if(p==='/api/assets'&&method==='GET'){
    const rows=(await env.DB.prepare(`SELECT a.*,p.name product_name FROM assets a LEFT JOIN products p ON p.id=a.product_id ORDER BY a.created_at DESC LIMIT 500`).all()).results||[]; return json(rows.map(a=>({...a,platforms:parseJSON(a.platforms_json,[])})));
  }
  if(p==='/api/assets/upload'&&method==='POST'){
    const form=await request.formData(), files=form.getAll('files').filter(x=>x&&typeof x.arrayBuffer==='function'); if(!files.length)return fail(new Error('Choose at least one file'));
    const productId=form.get('product_id')||null,status=form.get('status')||'approved'; const created=[];
    for(const file of files){
      const bytes=await file.arrayBuffer(); const hash=await sha256Hex(bytes); const dup=await env.DB.prepare(`SELECT id,original_name FROM assets WHERE sha256=?`).bind(hash).first(); if(dup){created.push({duplicate:true,id:dup.id,name:file.name});continue;}
      const aid=id('ast'), key=`assets/${aid}/${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`, token=crypto.randomUUID().replaceAll('-',''); await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:file.type||'application/octet-stream'}});
      const candidates=await productsList(env); const cls=await classifyAsset(env,{bytes,mime:file.type||'application/octet-stream',filename:file.name||'',products:candidates}); const resolvedProductId=productId||cls.product_id||null;
      await env.DB.prepare(`INSERT INTO assets(id,product_id,r2_key,public_token,original_name,mime_type,size_bytes,campaign_type,theme,audience,platforms_json,has_qr,has_testimonial,main_message,purpose,status,sha256,perceptual_hint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(aid,resolvedProductId,key,token,file.name,file.type||'',file.size,cls.campaign_type||'product',cls.theme||null,cls.audience||null,JSON.stringify(cls.platforms||[]),cls.has_qr?1:0,cls.has_testimonial?1:0,cls.main_message||null,cls.purpose||'sale',status,hash,cls.source||'heuristic',nowIso(),nowIso()).run(); created.push({id:aid,name:file.name,classified_by:cls.source});
    }
    await audit(env,{userId:user.id,type:'assets.uploaded',summary:`Uploaded ${created.filter(x=>!x.duplicate).length} assets`,data:{duplicates:created.filter(x=>x.duplicate).length}}); return json({items:created},201);
  }
  const assetPatch=p.match(/^\/api\/assets\/([^/]+)$/);
  if(assetPatch&&method==='PATCH'){
    const aid=assetPatch[1],x=await bodyJson(request),allowed=['product_id','campaign_type','theme','audience','has_qr','has_testimonial','main_message','purpose','status']; const sets=[],vals=[]; for(const k of allowed)if(k in x){sets.push(`${k}=?`);vals.push(x[k]);} if('platforms' in x){sets.push('platforms_json=?');vals.push(JSON.stringify(x.platforms||[]));} sets.push('updated_at=?');vals.push(nowIso(),aid); await env.DB.prepare(`UPDATE assets SET ${sets.join(',')} WHERE id=?`).bind(...vals).run(); return json({ok:true});
  }
  if(p==='/api/copy'&&method==='GET'){
    const rows=(await env.DB.prepare(`SELECT c.*,p.name product_name FROM copy_items c LEFT JOIN products p ON p.id=c.product_id ORDER BY c.updated_at DESC LIMIT 1000`).all()).results||[]; return json(rows);
  }
  if(p==='/api/copy'&&method==='POST'){
    const x=await bodyJson(request); if(!x.text)return fail(new Error('Copy text required')); const cid=id('cpy'),t=nowIso(); await env.DB.prepare(`INSERT INTO copy_items(id,product_id,copy_type,text,audience,platform,purpose,tone,length_class,campaign_type,status,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(cid,x.product_id||null,x.copy_type||'caption',x.text,x.audience||null,x.platform||null,x.purpose||null,x.tone||null,x.length_class||null,x.campaign_type||null,x.status||'approved',x.source||'human',t,t).run(); return json({id:cid},201);
  }
  if(p==='/api/ai/copy'&&method==='POST'){
    const x=await bodyJson(request); const product=await env.DB.prepare(`SELECT * FROM products WHERE id=?`).bind(x.product_id).first(); if(!product)return fail(new Error('Product not found'),404); const text=await generateCopy(env,product,x); return json({text});
  }
  if(p==='/api/campaigns/generate'&&method==='POST') return json(await generateWeek(env,user,request),201);
  if(p==='/api/week'&&method==='GET'){
    const start=url.searchParams.get('start')||startOfWeekISO(new Date(Date.now()+7*86400_000)); const rows=(await env.DB.prepare(`SELECT sp.*,p.name product_name,a.public_token,a.original_name FROM scheduled_posts sp JOIN campaigns c ON c.id=sp.campaign_id LEFT JOIN products p ON p.id=sp.product_id LEFT JOIN assets a ON a.id=sp.asset_id WHERE c.week_start=? ORDER BY sp.scheduled_for`).bind(start).all()).results||[]; return json({week_start:start,posts:rows});
  }
  const postPatch=p.match(/^\/api\/posts\/([^/]+)$/);
  if(postPatch&&method==='PATCH'){
    const postId=postPatch[1],x=await bodyJson(request),allowed=['caption','scheduled_for','status','product_id','asset_id']; const sets=[],vals=[]; for(const k of allowed)if(k in x){sets.push(`${k}=?`);vals.push(x[k]);} sets.push('updated_at=?');vals.push(nowIso(),postId); await env.DB.prepare(`UPDATE scheduled_posts SET ${sets.join(',')} WHERE id=?`).bind(...vals).run(); await audit(env,{userId:user.id,type:'post.updated',entityType:'scheduled_post',entityId:postId,summary:'Scheduled post updated'}); return json({ok:true});
  }
  if(p==='/api/connectors'&&method==='GET') return json((await env.DB.prepare(`SELECT * FROM connectors ORDER BY platform,priority`).all()).results||[]);
  if(p==='/api/connectors'&&method==='POST'){
    const x=await bodyJson(request); if(!x.platform||!x.connector_type)return fail(new Error('platform and connector_type required')); const cid=id('con'),t=nowIso(); const enc=x.secret?await encryptCredential(env,String(x.secret)):{ciphertext:null,iv:null}; await env.DB.prepare(`INSERT INTO connectors(id,name,connector_type,platform,enabled,priority,cost_cents_per_post,config_json,secret_ciphertext,secret_iv,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(cid,x.name||`${x.connector_type} ${x.platform}`,x.connector_type,x.platform,x.enabled===false?0:1,Number(x.priority||100),Number(x.cost_cents_per_post||0),JSON.stringify(x.config||{}),enc.ciphertext,enc.iv,t,t).run(); return json({id:cid},201);
  }
  if(p==='/api/performance'&&method==='GET'){
    const byPlatform=(await env.DB.prepare(`SELECT sp.platform,SUM(mm.impressions) impressions,SUM(mm.clicks) clicks,SUM(mm.conversions) conversions,SUM(mm.revenue_cents) revenue_cents FROM (SELECT post_id,MAX(impressions) impressions,MAX(clicks) clicks,MAX(conversions) conversions,MAX(revenue_cents) revenue_cents FROM metrics WHERE captured_at>=datetime('now','-90 days') GROUP BY post_id) mm JOIN scheduled_posts sp ON sp.id=mm.post_id GROUP BY sp.platform ORDER BY revenue_cents DESC`).all()).results||[];
    const byProduct=(await env.DB.prepare(`SELECT p.id product_id,p.name,COALESCE(pm.impressions,0) impressions,COALESCE(pm.clicks,0) clicks,MAX(COALESCE(pm.conversions,0),COALESCE(se.sales_count,0)) conversions,COALESCE(pm.revenue_cents,0)+COALESCE(se.revenue_cents,0) revenue_cents FROM products p LEFT JOIN (SELECT sp.product_id,SUM(mm.impressions) impressions,SUM(mm.clicks) clicks,SUM(mm.conversions) conversions,SUM(mm.revenue_cents) revenue_cents FROM (SELECT post_id,MAX(impressions) impressions,MAX(clicks) clicks,MAX(conversions) conversions,MAX(revenue_cents) revenue_cents FROM metrics WHERE captured_at>=datetime('now','-90 days') GROUP BY post_id) mm JOIN scheduled_posts sp ON sp.id=mm.post_id GROUP BY sp.product_id) pm ON pm.product_id=p.id LEFT JOIN (SELECT product_id,SUM(amount_cents) revenue_cents,SUM(CASE WHEN event_type='paid' THEN 1 ELSE 0 END) sales_count FROM sales_events WHERE occurred_at>=datetime('now','-90 days') GROUP BY product_id) se ON se.product_id=p.id ORDER BY revenue_cents DESC`).all()).results||[]; return json({byPlatform,byProduct});
  }
  if(p==='/api/metrics'&&method==='POST'){
    const x=await bodyJson(request); if(!x.post_id||!x.platform)return fail(new Error('post_id and platform required')); const source=x.source||'manual'; await env.DB.prepare(`INSERT INTO metrics(id,post_id,platform,source,impressions,reach,engagements,clicks,landing_visits,conversions,revenue_cents,captured_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(post_id,source) DO UPDATE SET impressions=excluded.impressions,reach=excluded.reach,engagements=excluded.engagements,clicks=excluded.clicks,landing_visits=excluded.landing_visits,conversions=excluded.conversions,revenue_cents=excluded.revenue_cents,captured_at=excluded.captured_at`).bind(`met_${source}_${x.post_id}`,x.post_id,x.platform,source,Number(x.impressions||0),Number(x.reach||0),Number(x.engagements||0),Number(x.clicks||0),Number(x.landing_visits||0),Number(x.conversions||0),Number(x.revenue_cents||0),nowIso()).run(); return json({ok:true},201);
  }
  if(p==='/api/needs-attention'&&method==='GET'){
    const failed=(await env.DB.prepare(`SELECT sp.*,p.name product_name FROM scheduled_posts sp LEFT JOIN products p ON p.id=sp.product_id WHERE sp.status='failed' ORDER BY sp.updated_at DESC LIMIT 100`).all()).results||[]; const healthRows=(await env.DB.prepare(`SELECT * FROM health_events WHERE resolved=0 ORDER BY created_at DESC LIMIT 100`).all()).results||[]; return json({failed,health:healthRows});
  }
  if(p==='/api/audit'&&method==='GET') return json((await env.DB.prepare(`SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 200`).all()).results||[]);
  if(p==='/api/settings'&&method==='GET') return json({posting_policy:await setting(env,'posting_policy',{}),autopilot:await setting(env,'autopilot',{}),optimization:await setting(env,'optimization',{}),marketing_timezone:await setting(env,'marketing_timezone',{iana:'UTC'}),cost_control:await setting(env,'cost_control',{approved_monthly_cost_cents:0,ai_estimated_cents_per_call:1})});
  if(p==='/api/settings'&&method==='PATCH'){
    const x=await bodyJson(request); for(const k of ['posting_policy','autopilot','optimization','marketing_timezone','cost_control'])if(k in x)await setSetting(env,k,x[k]); await audit(env,{userId:user.id,type:'settings.updated',summary:'Marketing settings updated'}); return json({ok:true});
  }
  if(p==='/api/users'&&method==='GET') return json((await env.DB.prepare(`SELECT id,email,role,status,created_at,last_login_at FROM users ORDER BY created_at`).all()).results||[]);
  if(p==='/api/users'&&method==='POST') return json(await createUser(env,user,await bodyJson(request)),201);
  if(p==='/api/seed-demo'&&method==='POST'){
    const count=await env.DB.prepare(`SELECT COUNT(*) n FROM products`).first(); if(Number(count?.n||0)>0)return fail(new Error('Demo seed only runs when product catalog is empty'));
    const t=nowIso(), p1=id('prd'),p2=id('prd'),p3=id('prd');
    const stmt=env.DB.prepare(`INSERT INTO products(id,name,product_type,brand,short_description,audience,features_json,benefits_json,price_cents,currency,sales_url,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    await env.DB.batch([
      stmt.bind(p1,'Thai-Ready','learning app','Example Brand','Practical Thai phrases for everyday life.','Travelers and expats','["Practical phrases","Pronunciation help"]','["Communicate with more confidence"]',2995,'USD','https://example.com/thai-ready','active',t,t),
      stmt.bind(p2,'Forest Story One','book','Example Press','A gentle illustrated woodland story.','Families with young readers','["Illustrated story"]','["Shared reading time"]',499,'USD','https://example.com/book-one','active',t,t),
      stmt.bind(p3,'Stage Companion','music app','Example Music','Simple set-list organization for working musicians.','Working musicians','["Set lists","Practice notes"]','["Less stage admin"]',1995,'USD','https://example.com/stage','active',t,t)
    ]);
    for(const [pid,text] of [[p1,'Learn the Thai you will actually use in everyday situations.'],[p2,'Step into a gentle woodland story made for reading together.'],[p3,'Spend less time organizing songs and more time playing them.']]) await env.DB.prepare(`INSERT INTO copy_items(id,product_id,copy_type,text,purpose,tone,length_class,status,source,created_at,updated_at) VALUES(?,?, 'caption',?,'sale','clear','short','approved','system',?,?)`).bind(id('cpy'),pid,text,t,t).run();
    for(const platform of ['facebook','instagram','tiktok','pinterest']) await env.DB.prepare(`INSERT INTO connectors(id,name,connector_type,platform,enabled,priority,cost_cents_per_post,config_json,created_at,updated_at) VALUES(?,?,?,?,1,999,0,'{}',?,?)`).bind(id('con'),`Sandbox ${platform}`,'sandbox',platform,t,t).run();
    await env.DB.prepare(`INSERT INTO connectors(id,name,connector_type,platform,enabled,priority,cost_cents_per_post,config_json,created_at,updated_at) VALUES(?,?,?,?,1,999,0,'{}',?,?)`).bind(id('con'),'Sandbox email','sandbox','email',t,t).run();
    await audit(env,{userId:user.id,type:'demo.seeded',summary:'Created demo products, copy, and zero-cost sandbox connectors'}); return json({ok:true});
  }
  return json({error:'Not found'},404);
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    try{
      if(url.pathname.startsWith('/public-media/')){
        const token=url.pathname.split('/').pop(); const row=await env.DB.prepare(`SELECT r2_key,mime_type FROM assets WHERE public_token=? AND status IN ('approved','experimental')`).bind(token).first(); if(!row)return new Response('Not found',{status:404}); const obj=await env.MEDIA.get(row.r2_key); if(!obj)return new Response('Not found',{status:404}); return new Response(obj.body,{headers:{'content-type':row.mime_type||'application/octet-stream','cache-control':'public,max-age=3600'}});
      }
      if(url.pathname.startsWith('/r/')){
        const code=url.pathname.split('/').pop(); const row=await env.DB.prepare(`SELECT p.sales_url,p.freebie_url,sp.id post_id,sp.platform FROM scheduled_posts sp JOIN products p ON p.id=sp.product_id WHERE sp.tracking_code=?`).bind(code).first(); if(!row)return new Response('Not found',{status:404}); await env.DB.prepare(`INSERT INTO metrics(id,post_id,platform,source,clicks,captured_at) VALUES(?,?,?,?,1,?) ON CONFLICT(post_id,source) DO UPDATE SET clicks=clicks+1,captured_at=excluded.captured_at`).bind(`met_tracking_${row.post_id}`,row.post_id,row.platform,'tracking',nowIso()).run(); const target=row.sales_url||row.freebie_url; if(!target)return new Response('Destination unavailable',{status:410}); const dest=new URL(target); if(!dest.searchParams.has('utm_source'))dest.searchParams.set('utm_source','marketing-autopilot'); if(!dest.searchParams.has('utm_medium'))dest.searchParams.set('utm_medium',row.platform); if(!dest.searchParams.has('utm_campaign'))dest.searchParams.set('utm_campaign',code); if(dest.hostname.endsWith('payhip.com')&&dest.pathname==='/buy'&&dest.searchParams.has('link'))dest.searchParams.set('metadata[ma_tracking]',code); return Response.redirect(dest.toString(),302);
      }
      if(url.pathname==='/webhooks/payhip'&&request.method==='POST') return await handlePayhipWebhook(env,request);
      if(url.pathname==='/api/auth/status') return json(await authStatus(env));
      if(url.pathname==='/api/auth/bootstrap'&&request.method==='POST'){ if(!assertSameOrigin(request,env))return fail(new Error('Origin rejected'),403); return json(await bootstrap(env),201); }
      if(url.pathname==='/api/auth/login'&&request.method==='POST'){ if(!assertSameOrigin(request,env))return fail(new Error('Origin rejected'),403); const x=await bodyJson(request), result=await login(env,x.email,x.password); if(!result)return fail(new Error('Invalid email or password'),401); return json({user:result.user},200,{'set-cookie':result.cookie}); }
      if(url.pathname==='/api/auth/logout'&&request.method==='POST'){ const cookie=await logout(env,request); return json({ok:true},200,{'set-cookie':cookie}); }
      if(url.pathname==='/api/auth/me'){ const u=await requireUser(env,request); return u?json({user:{id:u.id,email:u.email,role:u.role}}):unauth(); }
      if(url.pathname.startsWith('/api/')){
        if(!assertSameOrigin(request,env))return fail(new Error('Origin rejected'),403); const user=await requireUser(env,request); if(!user)return unauth(); return await api(env,request,user,url);
      }
      return env.STATIC.fetch(request);
    }catch(e){ console.error(e); return fail(e,500); }
  },
  async scheduled(controller,env){
    if(controller.cron==='*/5 * * * *'){ try{await publishDue(env);await resolveHealth(env,'scheduler');}catch(e){await health(env,'scheduler','red',String(e.message||e).slice(0,300));} }
    if(controller.cron==='17 3 * * *'){ try{await nightly(env);await resolveHealth(env,'nightly');}catch(e){await health(env,'nightly','yellow',String(e.message||e).slice(0,300));} }
  }
};
