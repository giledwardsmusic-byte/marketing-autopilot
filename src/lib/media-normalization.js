import { health, resolveHealth } from './db.js';
import { sendAlertOnce } from './notifications.js';

export const PLATFORM_IMAGE_PROFILES=Object.freeze({
  pinterest:{width:1000,height:1500,ratio:'2:3',fit:'cover',format:'image/jpeg',quality:88},
  instagram:{width:1080,height:1350,ratio:'4:5',fit:'cover',format:'image/jpeg',quality:90},
  facebook:{width:1200,height:1500,ratio:'4:5',fit:'contain',format:'image/jpeg',quality:90},
  tiktok:{width:1080,height:1920,ratio:'9:16',fit:'cover',format:'image/jpeg',quality:88}
});

export function profileForPlatform(platform){
  const p=PLATFORM_IMAGE_PROFILES[String(platform||'').toLowerCase()];
  if(!p)throw new Error(`Unsupported media platform: ${platform}`);
  return p;
}

export function variantPath(platform,token){
  if(!token)throw new Error('public media token is required');
  profileForPlatform(platform);
  return `/media-variant/${encodeURIComponent(String(platform).toLowerCase())}/${encodeURIComponent(token)}`;
}

export function variantStorageKey(platform,token,sha256=''){
  profileForPlatform(platform);
  if(!token)throw new Error('public media token is required');
  const source=String(sha256||'unhashed').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)||'unhashed';
  return `derived/${String(platform).toLowerCase()}/${encodeURIComponent(String(token))}-${source}.jpg`;
}

export function validateOriginalForPlatform(platform,row){
  const p=String(platform||'').toLowerCase();
  const mime=String(row?.mime_type||'').toLowerCase();
  const w=Number(row?.width||0), h=Number(row?.height||0), bytes=Number(row?.size_bytes||0);
  if(!mime.startsWith('image/'))return {ok:false,reason:'source is not an image'};
  if(bytes>20*1024*1024)return {ok:false,reason:'source image exceeds 20 MB safety limit'};
  if(!w||!h)return {ok:false,reason:'source image dimensions are unknown'};
  const ratio=w/h;
  if(p==='instagram'){
    if(mime!=='image/jpeg')return {ok:false,reason:'Instagram fallback requires JPEG'};
    if(ratio<0.8||ratio>1.91)return {ok:false,reason:`Instagram fallback aspect ratio ${ratio.toFixed(3)} is outside 4:5 through 1.91:1`};
    return {ok:true};
  }
  if(p==='pinterest'){
    if(!['image/jpeg','image/png','image/webp'].includes(mime))return {ok:false,reason:`Pinterest fallback does not accept ${mime}`};
    return {ok:true};
  }
  if(p==='facebook'){
    if(!['image/jpeg','image/png','image/webp'].includes(mime))return {ok:false,reason:`Facebook fallback does not accept ${mime}`};
    return {ok:true};
  }
  if(p==='tiktok'){
    if(!['image/jpeg','image/webp'].includes(mime))return {ok:false,reason:`TikTok photo fallback does not accept ${mime}`};
    if(Math.max(w,h)>1920||Math.min(w,h)>1080)return {ok:false,reason:'TikTok photo fallback exceeds 1080p image limit'};
    return {ok:true};
  }
  return {ok:false,reason:`unsupported platform ${platform}`};
}

function mediaHealthComponent(platform,token){
  return `media:${platform}:${token}`;
}

async function clearMediaHealth(env,platform,token){
  try{await resolveHealth(env,mediaHealthComponent(platform,token));}catch{}
}

async function noteFallback(env,platform,token,message,severity='yellow'){
  const component=mediaHealthComponent(platform,token);
  try{await health(env,component,severity,message);}catch{}
  try{await sendAlertOnce(env,{key:`media:${platform}:${token}:${severity}`,subject:`Marketing Autopilot media ${severity==='red'?'blocked':'fallback'}: ${platform}`,text:message});}catch{}
}

function normalizedResponse(body,platform,profile,cacheState='generated'){
  return new Response(body,{status:200,headers:{'content-type':profile.format,'cache-control':'public,max-age=86400,stale-while-revalidate=604800','x-ma-media-state':'normalized','x-ma-platform':String(platform),'x-ma-ratio':profile.ratio,'x-ma-variant-cache':cacheState}});
}

async function fallbackOriginal(env,platform,token,row,reason){
  const check=validateOriginalForPlatform(platform,row);
  if(!check.ok){
    const message=`${platform} post media was paused instead of sending broken media. Image normalization failed (${reason}); original cannot be used safely: ${check.reason}.`;
    await noteFallback(env,platform,token,message,'red');
    return new Response(message,{status:415,headers:{'x-ma-media-state':'blocked','x-ma-fallback-reason':String(check.reason).slice(0,180)}});
  }
  const fresh=await env.MEDIA.get(row.r2_key);
  if(!fresh){
    const message=`${platform} post media was paused because normalization failed (${reason}) and the original asset could not be reopened from storage.`;
    await noteFallback(env,platform,token,message,'red');
    return new Response(message,{status:503,headers:{'x-ma-media-state':'blocked','x-ma-fallback-reason':'original asset unavailable'}});
  }
  const message=`${platform} image normalization was bypassed (${reason}). The original asset passed platform fallback validation and was served so the scheduled post can continue.`;
  await noteFallback(env,platform,token,message,'yellow');
  return new Response(fresh.body,{status:200,headers:{'content-type':row.mime_type,'cache-control':'public,max-age=3600','x-ma-media-state':'original-fallback','x-ma-platform':String(platform)}});
}

export async function serveImageVariant(env,platform,token){
  const profile=profileForPlatform(platform);
  const row=await env.DB.prepare(`SELECT r2_key,mime_type,size_bytes,width,height,status,sha256 FROM assets WHERE public_token=? LIMIT 1`).bind(token).first();
  if(!row||!['approved','experimental'].includes(row.status))return new Response('Not found',{status:404});
  if(!String(row.mime_type||'').startsWith('image/'))return new Response('Source asset is not an image',{status:415});

  const cacheKey=variantStorageKey(platform,token,row.sha256);
  try{
    const cached=await env.MEDIA.get(cacheKey);
    if(cached){
      await clearMediaHealth(env,platform,token);
      return normalizedResponse(cached.body,platform,profile,'hit');
    }
  }catch{}

  const obj=await env.MEDIA.get(row.r2_key);
  if(!obj){
    const message=`${platform} post media was paused because the approved source asset is missing from storage. No platform publishing call should be attempted until the source is restored.`;
    await noteFallback(env,platform,token,message,'red');
    return new Response(message,{status:415,headers:{'x-ma-media-state':'blocked','x-ma-fallback-reason':'source asset unavailable'}});
  }
  if(!env.IMAGES)return fallbackOriginal(env,platform,token,row,'Cloudflare Images binding unavailable');
  try{
    const pipeline=env.IMAGES.input(obj.body)
      .transform({width:profile.width,height:profile.height,fit:profile.fit})
      .output({format:profile.format,quality:profile.quality});
    const transformed=await pipeline.response();
    if(!transformed.ok){
      let body=`HTTP ${transformed.status}`;
      try{if(typeof transformed.text==='function')body=await transformed.text();}catch{}
      const quota=transformed.status===429||String(body).includes('9422');
      return fallbackOriginal(env,platform,token,row,quota?'Cloudflare transformation quota exhausted':`Cloudflare transform HTTP ${transformed.status}`);
    }
    const bytes=await transformed.arrayBuffer();
    let cacheState='generated';
    try{
      await env.MEDIA.put(cacheKey,bytes,{httpMetadata:{contentType:profile.format},customMetadata:{source_sha256:String(row.sha256||''),platform:String(platform),ratio:profile.ratio}});
    }catch{
      cacheState='uncached';
    }
    await clearMediaHealth(env,platform,token);
    return normalizedResponse(bytes,platform,profile,cacheState);
  }catch(e){
    const msg=String(e.message||e);
    return fallbackOriginal(env,platform,token,row,msg.includes('9422')?'Cloudflare transformation quota exhausted':msg.slice(0,180));
  }
}
