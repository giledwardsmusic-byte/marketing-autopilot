import { health } from './db.js';
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
  if(p==='tiktok')return {ok:false,reason:'TikTok static-image direct publishing is not enabled; vertical video/media route must be used'};
  return {ok:false,reason:`unsupported platform ${platform}`};
}

async function noteFallback(env,platform,token,message,severity='yellow'){
  const component=`media:${platform}:${token}`;
  try{await health(env,component,severity,message);}catch{}
  try{await sendAlertOnce(env,{key:`media:${platform}:${token}:${severity}`,subject:`Marketing Autopilot media ${severity==='red'?'blocked':'fallback'}: ${platform}`,text:message});}catch{}
}

async function fallbackOriginal(env,platform,token,row,obj,reason){
  const check=validateOriginalForPlatform(platform,row);
  if(!check.ok){
    const message=`${platform} post media was paused instead of sending broken media. Image normalization failed (${reason}); original cannot be used safely: ${check.reason}.`;
    await noteFallback(env,platform,token,message,'red');
    return new Response(message,{status:415,headers:{'x-ma-media-state':'blocked','x-ma-fallback-reason':String(check.reason).slice(0,180)}});
  }
  const message=`${platform} image normalization was bypassed (${reason}). The original asset passed platform fallback validation and was served so the scheduled post can continue.`;
  await noteFallback(env,platform,token,message,'yellow');
  return new Response(obj.body,{status:200,headers:{'content-type':row.mime_type,'cache-control':'public,max-age=3600','x-ma-media-state':'original-fallback','x-ma-platform':String(platform)}});
}

export async function serveImageVariant(env,platform,token){
  const profile=profileForPlatform(platform);
  const row=await env.DB.prepare(`SELECT r2_key,mime_type,size_bytes,width,height,status FROM assets WHERE public_token=? LIMIT 1`).bind(token).first();
  if(!row||!['approved','experimental'].includes(row.status))return new Response('Not found',{status:404});
  if(!String(row.mime_type||'').startsWith('image/'))return new Response('Source asset is not an image',{status:415});
  const obj=await env.MEDIA.get(row.r2_key); if(!obj)return new Response('Not found',{status:404});
  if(!env.IMAGES)return fallbackOriginal(env,platform,token,row,obj,'Cloudflare Images binding unavailable');
  try{
    const transformed=(await env.IMAGES.input(obj.body)
      .transform({width:profile.width,height:profile.height,fit:profile.fit})
      .output({format:profile.format,quality:profile.quality})).response();
    if(!transformed.ok){
      const body=await transformed.text().catch(()=>`HTTP ${transformed.status}`);
      const quota=transformed.status===429||body.includes('9422');
      return fallbackOriginal(env,platform,token,row,obj,quota?'Cloudflare transformation quota exhausted':`Cloudflare transform HTTP ${transformed.status}`);
    }
    return new Response(transformed.body,{status:transformed.status,headers:{...Object.fromEntries(transformed.headers),'content-type':profile.format,'cache-control':'public,max-age=86400,stale-while-revalidate=604800','x-ma-media-state':'normalized','x-ma-platform':String(platform),'x-ma-ratio':profile.ratio}});
  }catch(e){
    const msg=String(e.message||e);
    return fallbackOriginal(env,platform,token,row,obj,msg.includes('9422')?'Cloudflare transformation quota exhausted':msg.slice(0,180));
  }
}
