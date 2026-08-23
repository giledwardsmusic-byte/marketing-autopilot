const API='https://open.tiktokapis.com';

function ok(data){
  const code=data?.error?.code;
  return !code || code==='ok';
}

async function tiktokJson(fetchFn,url,token,body={}){
  const r=await fetchFn(url,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json; charset=UTF-8'},body:JSON.stringify(body)});
  const data=await r.json();
  if(!r.ok || !ok(data)) throw new Error(`TikTok ${r.status}: ${data?.error?.message||data?.error?.code||JSON.stringify(data)}`);
  return data;
}

export async function queryTikTokCreator(token,fetchFn=fetch){
  if(!token) throw new Error('TikTok access token not configured');
  const data=await tiktokJson(fetchFn,`${API}/v2/post/publish/creator_info/query/`,token,{});
  if(!data?.data?.creator_username) throw new Error('TikTok creator info returned no creator');
  return data.data;
}

function choosePrivacy(creator,requested){
  const allowed=creator.privacy_level_options||[];
  const privacy=requested || (allowed.includes('SELF_ONLY')?'SELF_ONLY':allowed[0]);
  if(!privacy || !allowed.includes(privacy)) throw new Error(`TikTok privacy level is not allowed for this creator: ${privacy||'none'}`);
  return privacy;
}

export async function tiktokDirectVideo({token,caption,videoUrl,privacyLevel,brandOrganic=true,isAigc=false,disableComment=false,disableDuet=false,disableStitch=false},fetchFn=fetch){
  if(!token) throw new Error('TikTok access token not configured');
  if(!videoUrl || !/^https:\/\//i.test(videoUrl)) throw new Error('TikTok direct post requires a public HTTPS video URL');
  const creator=await queryTikTokCreator(token,fetchFn);
  const privacy=choosePrivacy(creator,privacyLevel);
  const body={
    post_info:{
      title:String(caption||'').slice(0,2200),
      privacy_level:privacy,
      disable_comment:Boolean(disableComment || creator.comment_disabled),
      disable_duet:Boolean(disableDuet || creator.duet_disabled),
      disable_stitch:Boolean(disableStitch || creator.stitch_disabled),
      brand_organic_toggle:Boolean(brandOrganic),
      is_aigc:Boolean(isAigc)
    },
    source_info:{source:'PULL_FROM_URL',video_url:videoUrl}
  };
  const data=await tiktokJson(fetchFn,`${API}/v2/post/publish/video/init/`,token,body);
  const publishId=data?.data?.publish_id;
  if(!publishId) throw new Error('TikTok returned no publish id');
  return {externalId:publishId,state:'submitted',creatorUsername:creator.creator_username,privacyLevel:privacy};
}

export async function tiktokDirectPhoto({token,caption,photoUrls,privacyLevel,brandOrganic=true,brandContent=false,disableComment=false,autoAddMusic=false,title=''},fetchFn=fetch){
  if(!token) throw new Error('TikTok access token not configured');
  const urls=(Array.isArray(photoUrls)?photoUrls:[]).filter(u=>/^https:\/\//i.test(String(u||''))).slice(0,35);
  if(!urls.length) throw new Error('TikTok direct photo post requires at least one public HTTPS photo URL');
  const creator=await queryTikTokCreator(token,fetchFn);
  const privacy=choosePrivacy(creator,privacyLevel);
  const body={
    media_type:'PHOTO',
    post_mode:'DIRECT_POST',
    post_info:{
      title:String(title||'').slice(0,90),
      description:String(caption||'').slice(0,4000),
      privacy_level:privacy,
      disable_comment:Boolean(disableComment || creator.comment_disabled),
      auto_add_music:Boolean(autoAddMusic),
      brand_content_toggle:Boolean(brandContent),
      brand_organic_toggle:Boolean(brandOrganic)
    },
    source_info:{source:'PULL_FROM_URL',photo_images:urls,photo_cover_index:0}
  };
  const data=await tiktokJson(fetchFn,`${API}/v2/post/publish/content/init/`,token,body);
  const publishId=data?.data?.publish_id;
  if(!publishId) throw new Error('TikTok returned no publish id');
  return {externalId:publishId,state:'submitted',creatorUsername:creator.creator_username,privacyLevel:privacy,mediaType:'photo'};
}

export async function fetchTikTokPostStatus(token,publishId,fetchFn=fetch){
  if(!publishId) throw new Error('TikTok publish id required');
  const data=await tiktokJson(fetchFn,`${API}/v2/post/publish/status/fetch/`,token,{publish_id:publishId});
  return data.data||{};
}
