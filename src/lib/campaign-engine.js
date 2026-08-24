import { clamp } from './utils.js';


function localDateParts(startISO, dayOffset){
  const d=new Date(startISO); d.setUTCDate(d.getUTCDate()+dayOffset);
  return {year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate()};
}
function tzOffsetMs(date,timeZone){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const o=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  const asUTC=Date.UTC(+o.year,+o.month-1,+o.day,+o.hour,+o.minute,+o.second);
  return asUTC-date.getTime();
}
export function localSlotToUTC(startISO,dayOffset,hhmm,timeZone='UTC'){
  const {year,month,day}=localDateParts(startISO,dayOffset); const [hour,minute]=hhmm.split(':').map(Number);
  const wall=Date.UTC(year,month-1,day,hour,minute,0); let guess=new Date(wall);
  let offset=tzOffsetMs(guess,timeZone); guess=new Date(wall-offset); offset=tzOffsetMs(guess,timeZone);
  return new Date(wall-offset).toISOString();
}

const hoursSince = iso => iso ? Math.max(1,(Date.now()-new Date(iso).getTime())/36e5) : 24*365;
const daysSince = iso => hoursSince(iso)/24;

export function productScore(p, stats={}) {
  const s = stats[p.id] || {};
  const revenue = Number(s.revenue_cents||0);
  const conversions = Number(s.conversions||0);
  const clicks = Number(s.clicks||0);
  const impressions = Number(s.impressions||0);
  const convRate = clicks ? conversions/clicks : 0;
  const ctr = impressions ? clicks/impressions : 0;
  const freshness = p.launch_date ? clamp(30/(daysSince(p.launch_date)+3),0.4,3) : 1;
  const evidence = impressions >= 300 || clicks >= 12;
  const performance = evidence ? 1 + Math.log10(1+revenue/100)*0.22 + convRate*4 + ctr*2 : 1;
  return Math.max(0.1, Number(p.manual_priority||1) * freshness * performance);
}

function performanceMultiplier(s={}) {
  const impressions=Number(s.impressions||0), clicks=Number(s.clicks||0), conversions=Number(s.conversions||0), revenue=Number(s.revenue_cents||0);
  const enough=impressions>=300 || clicks>=12 || conversions>=2;
  if(!enough) return 1;
  const ctr=impressions?clicks/impressions:0, conv=clicks?conversions/clicks:0;
  return clamp(0.65 + Math.log10(1+revenue/100)*0.18 + ctr*3 + conv*5, 0.65, 2.2);
}

export function assetScore(a, experimentalShare=0.12, stats={}) {
  const age = Math.min(365, daysSince(a.last_used_at));
  const novelty = a.use_count === 0 ? 100 : age;
  const statusWeight = a.status === 'experimental' ? experimentalShare : 1;
  return novelty * statusWeight * performanceMultiplier(stats[a.id]) / Math.sqrt(1+Number(a.use_count||0));
}

export function copyScore(c, stats={}) {
  const age = Math.min(365, daysSince(c.last_used_at));
  return (c.use_count===0?80:age) * performanceMultiplier(stats[c.id]) / Math.sqrt(1+Number(c.use_count||0));
}

function weightedPick(items, scoreFn, avoidId=null) {
  const filtered = items.filter(x=>x.id!==avoidId);
  const pool = filtered.length ? filtered : items;
  if (!pool.length) return null;
  return pool.map(x=>({x,s:Math.max(0.001,scoreFn(x))})).sort((a,b)=>b.s-a.s)[0].x;
}

export function buildCaption(product, copyItem, trackingUrl) {
  const core = copyItem?.text?.trim() || `${product.name}${product.short_description ? ` — ${product.short_description}` : ''}`;
  return trackingUrl ? `${core}\n\n${trackingUrl}` : core;
}

export function generatePlan({ products, assets, copyItems, stats={}, assetStats={}, copyStats={}, postingPolicy, startISO, origin, experimentalShare=0.12, timeZone='UTC' }) {
  const activeProducts = products.filter(p=>p.status==='active');
  if (!activeProducts.length) return [];
  const platforms = Object.entries(postingPolicy||{});
  const out=[];
  const lastProductByPlatform={};
  const lastAssetByPlatform={};

  for (let day=0; day<7; day++) {
    for (const [platform, policy] of platforms) {
      let times=[];
      if (platform==='email') {
        if (day!==2) continue;
        times=(policy.times||['10:00']).slice(0, Number(policy.per_week||1));
      } else {
        times=(policy.times||['12:00']).slice(0, Number(policy.per_day||1));
      }
      for (const time of times) {
        const product = weightedPick(activeProducts, p=>productScore(p,stats), lastProductByPlatform[platform]);
        const eligibleAssets = assets.filter(a => ['approved','experimental'].includes(a.status) && (!a.product_id || a.product_id===product.id) && ((a.platforms_json||[]).length===0 || (a.platforms_json||[]).includes(platform)));
        const asset = weightedPick(eligibleAssets, a=>assetScore(a,experimentalShare,assetStats), lastAssetByPlatform[platform]);
        const eligibleCopy = copyItems.filter(c => ['approved','experimental'].includes(c.status) && (!c.product_id || c.product_id===product.id) && (!c.platform || c.platform===platform));
        const copyItem = weightedPick(eligibleCopy, c=>copyScore(c,copyStats));
        const trackingCode = crypto.randomUUID().replaceAll('-','').slice(0,16);
        const sales = product.sales_url || product.freebie_url || '';
        const trackingUrl = sales ? `${origin}/r/${trackingCode}` : '';
        out.push({platform,product,asset,copyItem,trackingCode,trackingUrl,scheduled_for:localSlotToUTC(startISO,day,time,timeZone)});
        lastProductByPlatform[platform]=product.id;
        if(asset) lastAssetByPlatform[platform]=asset.id;
      }
    }
  }
  return out.sort((a,b)=>a.scheduled_for.localeCompare(b.scheduled_for));
}

export function adaptPostingPolicy(policy, aggregate, optimization={}) {
  const minImp=optimization.minimum_impressions||300;
  const next=structuredClone(policy);
  for (const [platform,p] of Object.entries(next)) {
    if(platform==='email') continue;
    const a=aggregate[platform]||{};
    const impressions=Number(a.impressions||0), clicks=Number(a.clicks||0), conversions=Number(a.conversions||0), revenue=Number(a.revenue_cents||0);
    const hasSaleSignal=conversions>0 || revenue>0;
    if(impressions<minImp && !hasSaleSignal) continue;
    const ctr=impressions?clicks/impressions:0;
    const conv=clicks?conversions/clicks:0;
    const current=Number(p.per_day||1);
    // Paid outcomes outrank engagement: any observed sale/revenue is positive evidence even when click tracking is sparse.
    if((hasSaleSignal || conv>=0.03 || ctr>=0.02) && current<10) p.per_day=current+1;
    // Never reduce frequency while the same evaluation window contains a positive sale/revenue signal.
    if(!hasSaleSignal && conv===0 && ctr<0.005 && current>1) p.per_day=current-1;
    p.per_day=clamp(p.per_day,1,10);
  }
  return next;
}
