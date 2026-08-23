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

export async function serveImageVariant(env,platform,token){
  if(!env.IMAGES) return new Response('Image transformations are not configured',{status:503});
  const profile=profileForPlatform(platform);
  const row=await env.DB.prepare(`SELECT r2_key,mime_type,status FROM assets WHERE public_token=? LIMIT 1`).bind(token).first();
  if(!row||!['approved','experimental'].includes(row.status))return new Response('Not found',{status:404});
  if(!String(row.mime_type||'').startsWith('image/'))return new Response('Source asset is not an image',{status:415});
  const obj=await env.MEDIA.get(row.r2_key); if(!obj)return new Response('Not found',{status:404});
  try{
    const transformed=(await env.IMAGES.input(obj.body)
      .transform({width:profile.width,height:profile.height,fit:profile.fit})
      .output({format:profile.format,quality:profile.quality})).response();
    return new Response(transformed.body,{status:transformed.status,headers:{...Object.fromEntries(transformed.headers),'content-type':profile.format,'cache-control':'public,max-age=86400,stale-while-revalidate=604800','x-ma-platform':String(platform),'x-ma-ratio':profile.ratio}});
  }catch(e){
    return new Response(`Image normalization failed: ${String(e.message||e).slice(0,240)}`,{status:422});
  }
}
