import { id, nowIso, parseJSON, startOfWeekISO, endOfWeekISO } from './utils.js';
import { generatePlan, buildCaption } from './campaign-engine.js';
import { generateCopy } from './ai.js';
import { audit, health, resolveHealth, setting } from './db.js';

async function productRows(env){
  const rows=(await env.DB.prepare(`SELECT * FROM products WHERE status='active' ORDER BY updated_at DESC`).all()).results||[];
  return rows.map(r=>({...r,features:parseJSON(r.features_json,[]),benefits:parseJSON(r.benefits_json,[])}));
}

function toStats(rows){ return Object.fromEntries((rows||[]).filter(r=>r.entity_id).map(r=>[r.entity_id,{...r}])); }

async function performanceMaps(env){
  const productRows=(await env.DB.prepare(`SELECT sp.product_id entity_id,SUM(mm.impressions) impressions,SUM(mm.clicks) clicks,SUM(mm.conversions) conversions,SUM(mm.revenue_cents) revenue_cents FROM (SELECT post_id,MAX(impressions) impressions,MAX(clicks) clicks,MAX(conversions) conversions,MAX(revenue_cents) revenue_cents FROM metrics WHERE captured_at>=datetime('now','-90 days') GROUP BY post_id) mm JOIN scheduled_posts sp ON sp.id=mm.post_id WHERE sp.product_id IS NOT NULL GROUP BY sp.product_id`).all()).results||[];
  const assetRows=(await env.DB.prepare(`SELECT sp.asset_id entity_id,SUM(mm.impressions) impressions,SUM(mm.clicks) clicks,SUM(mm.conversions) conversions,SUM(mm.revenue_cents) revenue_cents FROM (SELECT post_id,MAX(impressions) impressions,MAX(clicks) clicks,MAX(conversions) conversions,MAX(revenue_cents) revenue_cents FROM metrics WHERE captured_at>=datetime('now','-90 days') GROUP BY post_id) mm JOIN scheduled_posts sp ON sp.id=mm.post_id WHERE sp.asset_id IS NOT NULL GROUP BY sp.asset_id`).all()).results||[];
  const copyRows=(await env.DB.prepare(`SELECT sp.copy_id entity_id,SUM(mm.impressions) impressions,SUM(mm.clicks) clicks,SUM(mm.conversions) conversions,SUM(mm.revenue_cents) revenue_cents FROM (SELECT post_id,MAX(impressions) impressions,MAX(clicks) clicks,MAX(conversions) conversions,MAX(revenue_cents) revenue_cents FROM metrics WHERE captured_at>=datetime('now','-90 days') GROUP BY post_id) mm JOIN scheduled_posts sp ON sp.id=mm.post_id WHERE sp.copy_id IS NOT NULL GROUP BY sp.copy_id`).all()).results||[];
  const sales=(await env.DB.prepare(`SELECT se.product_id entity_id,SUM(se.amount_cents) revenue_cents,SUM(CASE WHEN se.event_type='paid' THEN 1 ELSE 0 END) conversions FROM sales_events se WHERE se.occurred_at>=datetime('now','-90 days') AND se.product_id IS NOT NULL GROUP BY se.product_id`).all()).results||[];
  const saleAssets=(await env.DB.prepare(`SELECT sp.asset_id entity_id,SUM(se.amount_cents) revenue_cents FROM sales_events se JOIN scheduled_posts sp ON sp.id=se.post_id WHERE se.occurred_at>=datetime('now','-90 days') AND sp.asset_id IS NOT NULL GROUP BY sp.asset_id`).all()).results||[];
  const saleCopy=(await env.DB.prepare(`SELECT sp.copy_id entity_id,SUM(se.amount_cents) revenue_cents FROM sales_events se JOIN scheduled_posts sp ON sp.id=se.post_id WHERE se.occurred_at>=datetime('now','-90 days') AND sp.copy_id IS NOT NULL GROUP BY sp.copy_id`).all()).results||[];
  const products=toStats(productRows),assets=toStats(assetRows),copy=toStats(copyRows);
  for(const r of sales){products[r.entity_id]=products[r.entity_id]||{};products[r.entity_id].revenue_cents=Number(products[r.entity_id].revenue_cents||0)+Number(r.revenue_cents||0);products[r.entity_id].conversions=Math.max(Number(products[r.entity_id].conversions||0),Number(r.conversions||0));}
  for(const r of saleAssets){assets[r.entity_id]=assets[r.entity_id]||{};assets[r.entity_id].revenue_cents=Number(assets[r.entity_id].revenue_cents||0)+Number(r.revenue_cents||0);}
  for(const r of saleCopy){copy[r.entity_id]=copy[r.entity_id]||{};copy[r.entity_id].revenue_cents=Number(copy[r.entity_id].revenue_cents||0)+Number(r.revenue_cents||0);}
  return {products,assets,copy};
}

async function saveGeneratedCopy(env,product,platform,text){
  const existing=await env.DB.prepare(`SELECT id FROM copy_items WHERE product_id=? AND platform=? AND text=? LIMIT 1`).bind(product.id,platform,text).first();
  if(existing) return existing.id;
  const cid=id('cpy'),t=nowIso();
  await env.DB.prepare(`INSERT INTO copy_items(id,product_id,copy_type,text,platform,purpose,tone,length_class,status,source,created_at,updated_at) VALUES(?,?, 'caption',?,?, 'sale','clear','medium','approved','ai',?,?)`).bind(cid,product.id,text,platform,t,t).run();
  return cid;
}

async function prepareWeek(env,start,origin){
  const existing=await env.DB.prepare(`SELECT id FROM campaigns WHERE week_start=? AND status IN ('planned','active') LIMIT 1`).bind(start).first();
  if(existing) return {reused:true,campaign_id:existing.id,count:0};
  const products=await productRows(env); if(!products.length) return {count:0};
  const assets=((await env.DB.prepare(`SELECT * FROM assets WHERE status IN ('approved','experimental')`).all()).results||[]).map(a=>({...a,platforms_json:parseJSON(a.platforms_json,[])}));
  let copyItems=(await env.DB.prepare(`SELECT * FROM copy_items WHERE status IN ('approved','experimental')`).all()).results||[];

  // Fill thin copy libraries before scheduling. The AI layer itself obeys the approved cost ceiling.
  for(const product of products){
    const count=copyItems.filter(c=>c.product_id===product.id).length;
    if(count>=4) continue;
    try{
      const text=await generateCopy(env,product,{platform:'facebook',purpose:'sale'});
      const cid=await saveGeneratedCopy(env,product,'facebook',text);
      if(!copyItems.some(c=>c.id===cid)) copyItems.push({id:cid,product_id:product.id,copy_type:'caption',text,platform:'facebook',status:'approved',source:'ai',use_count:0,last_used_at:null});
    }catch(e){ await health(env,`content:${product.id}`,'yellow',`Could not fill a copy gap for ${product.name}: ${String(e.message||e).slice(0,180)}`); }
  }

  const perf=await performanceMaps(env);
  const policy=await setting(env,'posting_policy',{}),autopilot=await setting(env,'autopilot',{enabled:true,experimental_share:0.12}),tz=await setting(env,'marketing_timezone',{iana:'UTC'});
  const plan=generatePlan({products,assets,copyItems,stats:perf.products,assetStats:perf.assets,copyStats:perf.copy,postingPolicy:policy,startISO:start,origin,experimentalShare:autopilot.experimental_share||0.12,timeZone:tz.iana||'UTC'}).filter(x=>new Date(x.scheduled_for).getTime()>Date.now()+5*60_000);
  if(!plan.length) return {count:0};
  const campaignId=id('camp'),end=endOfWeekISO(start),t=nowIso();
  await env.DB.prepare(`INSERT INTO campaigns(id,name,week_start,week_end,status,autopilot,generated_at,generated_by) VALUES(?,?,?,?, 'planned',1,?,'autopilot')`).bind(campaignId,`Week of ${start.slice(0,10)}`,start,end,t).run();
  for(const item of plan){
    let copyId=item.copyItem?.id||null;
    let caption=buildCaption(item.product,item.copyItem,item.trackingUrl);
    if(!item.copyItem){
      const text=await generateCopy(env,item.product,{platform:item.platform,purpose:'sale',assetMessage:item.asset?.main_message||''});
      copyId=await saveGeneratedCopy(env,item.product,item.platform,text);
      caption=item.trackingUrl?`${text}\n\n${item.trackingUrl}`:text;
    }
    await env.DB.prepare(`INSERT INTO scheduled_posts(id,campaign_id,product_id,asset_id,copy_id,platform,caption,scheduled_for,status,approval_mode,tracking_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?, 'scheduled','autopilot',?,?,?)`).bind(id('post'),campaignId,item.product.id,item.asset?.id||null,copyId,item.platform,caption,item.scheduled_for,item.trackingCode,t,t).run();
  }
  await audit(env,{type:'campaign.autopilot_generated',entityType:'campaign',entityId:campaignId,summary:`Autopilot prepared ${plan.length} scheduled items for ${start.slice(0,10)}`});
  return {campaign_id:campaignId,count:plan.length};
}

export async function ensureAutopilotCampaigns(env){
  const config=await setting(env,'autopilot',{enabled:true});
  if(config.enabled===false) return {skipped:true};
  const runtime=await setting(env,'runtime_origin',{origin:env.APP_ORIGIN}); const origin=runtime.origin||env.APP_ORIGIN;
  const starts=[startOfWeekISO(new Date()),startOfWeekISO(new Date(Date.now()+7*86400_000))];
  const results=[];
  try{
    for(const start of starts) results.push(await prepareWeek(env,start,origin));
    await resolveHealth(env,'autopilot:campaigns');
    return {ok:true,results};
  }catch(e){
    await health(env,'autopilot:campaigns','yellow',`Autopilot campaign preparation failed: ${String(e.message||e).slice(0,220)}`);
    throw e;
  }
}
