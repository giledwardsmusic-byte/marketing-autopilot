function apiError(prefix,status,data){
  const message=data?.message||data?.error?.message||data?.error_description||JSON.stringify(data||{});
  return new Error(`${prefix} ${status}: ${message}`);
}

export async function publishPinterestPin({token,boardId,imageUrl,description='',title='',link,apiBase='https://api.pinterest.com/v5',fetchImpl=fetch}){
  if(!token)throw new Error('Pinterest access token not configured');
  if(!boardId)throw new Error('Pinterest board_id is required');
  if(!imageUrl)throw new Error('Pinterest image URL is required');
  const body={
    board_id:String(boardId),
    description:String(description||'').slice(0,800),
    media_source:{source_type:'image_url',url:String(imageUrl),is_standard:true}
  };
  if(title)body.title=String(title).slice(0,100);
  if(link)body.link=String(link);
  const r=await fetchImpl(`${apiBase}/pins`,{
    method:'POST',
    headers:{'content-type':'application/json','accept':'application/json','authorization':`Bearer ${token}`},
    body:JSON.stringify(body)
  });
  let data={};
  try{data=await r.json();}catch{data={};}
  if(!r.ok)throw apiError('Pinterest',r.status,data);
  if(!data?.id)throw new Error('Pinterest returned no Pin id');
  return {externalId:String(data.id),state:'published'};
}
