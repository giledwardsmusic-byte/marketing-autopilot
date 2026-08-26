import { health, resolveHealth, setSetting, setting } from './db.js';
import { imageDimensions } from './image-dimensions.js';

export const DEFAULT_DRIVE_FOLDER_ID='13V50CtAtjWRZ0H_F9kBbjDdWBdsjxxDE';
const COPY_BANK_TITLE='Marketing Copy Bank - Table Rock Press';
const ARCHIVE_TITLE='Marketing Autopilot Archive.json';
const DRIVE_FOLDER_MIME='application/vnd.google-apps.folder';
const DRIVE_MEDIA_MAX_BYTES=25*1024*1024;
const DRIVE_MEDIA_MIMES=new Set(['image/jpeg','image/png','image/webp']);

export function driveSyncConfigured(env){
  return Boolean(env.GOOGLE_DRIVE_CLIENT_ID&&env.GOOGLE_DRIVE_CLIENT_SECRET&&env.GOOGLE_DRIVE_REFRESH_TOKEN);
}

export function driveMediaCandidate(file){
  if(!file||!DRIVE_MEDIA_MIMES.has(String(file.mimeType||'').toLowerCase()))return false;
  const size=Number(file.size||0);
  if(size<=0||size>DRIVE_MEDIA_MAX_BYTES)return false;
  const name=String(file.name||'').toLowerCase();
  if(name.includes('logo'))return false;
  return true;
}

async function accessToken(env){
  const body=new URLSearchParams({client_id:env.GOOGLE_DRIVE_CLIENT_ID,client_secret:env.GOOGLE_DRIVE_CLIENT_SECRET,refresh_token:env.GOOGLE_DRIVE_REFRESH_TOKEN,grant_type:'refresh_token'});
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||!data.access_token)throw new Error(`Google OAuth refresh failed (${r.status}): ${data.error_description||data.error||'no access token'}`);
  return data.access_token;
}

async function driveJson(token,url,init={}){
  const r=await fetch(url,{...init,headers:{...(init.headers||{}),authorization:`Bearer ${token}`}});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(`Google Drive ${r.status}: ${data?.error?.message||JSON.stringify(data)}`);
  return data;
}

async function listChildren(token,parentId){
  const files=[]; let pageToken='';
  do{
    const q=encodeURIComponent(`'${parentId}' in parents and trashed=false`).replace(/'/g,'%27');
    const page=pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:'';
    const data=await driveJson(token,`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=1000&fields=nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,size)${page}`);
    for(const file of data.files||[])files.push({...file,parent_id:parentId});
    pageToken=data.nextPageToken||'';
  }while(pageToken);
  return files;
}

async function listFolderTree(token,rootFolderId){
  const all=[]; const queue=[rootFolderId]; const visited=new Set();
  while(queue.length){
    const folderId=queue.shift();
    if(visited.has(folderId))continue;
    visited.add(folderId);
    if(visited.size>250)throw new Error('Google Drive source exceeded 250 nested folders; sync stopped safely');
    const children=await listChildren(token,folderId);
    all.push(...children);
    for(const child of children)if(child.mimeType===DRIVE_FOLDER_MIME)queue.push(child.id);
  }
  return all;
}

export async function listFolderFiles(env){
  if(!driveSyncConfigured(env))return [];
  const token=await accessToken(env); const folder=env.GOOGLE_DRIVE_FOLDER_ID||DEFAULT_DRIVE_FOLDER_ID;
  return listFolderTree(token,folder);
}

export function parseCopyBank(text){
  const source=String(text||'').replace(/\r/g,'');
  const stop=source.indexOf('\nAsset inventory now visible in Drive');
  const body=stop>=0?source.slice(0,stop):source;
  const matches=[...body.matchAll(/^[ \t]*(\d+)\.[ \t]+([^\n]+)\n/gm)];
  const out=[];
  for(let i=0;i<matches.length;i++){
    const m=matches[i];
    const start=m.index+m[0].length;
    const end=i+1<matches.length?matches[i+1].index:body.length;
    const copy=body.slice(start,end).trim();
    if(copy)out.push({number:Number(m[1]),title:m[2].trim(),text:copy});
  }
  return out;
}

async function fetchCopyBankText(token,fileId){
  const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fplain`,{headers:{authorization:`Bearer ${token}`}});
  if(!r.ok)throw new Error(`Google Drive copy-bank export failed (${r.status})`);
  return r.text();
}

async function importCopyBank(env,token,files){
  const doc=files.find(f=>f.name===COPY_BANK_TITLE&&f.mimeType==='application/vnd.google-apps.document');
  if(!doc)throw new Error(`Drive source is missing ${COPY_BANK_TITLE}`);
  const text=await fetchCopyBankText(token,doc.id); const blocks=parseCopyBank(text);
  if(!blocks.length)throw new Error('Marketing Copy Bank contained no numbered copy blocks');
  const t=new Date().toISOString(); let changed=0;
  for(const block of blocks){
    const id=`cpy_drive_buddy_${block.number}`;
    const found=await env.DB.prepare(`SELECT text FROM copy_items WHERE id=?`).bind(id).first();
    if(!found){
      await env.DB.prepare(`INSERT INTO copy_items(id,product_id,copy_type,text,audience,purpose,tone,length_class,campaign_type,status,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,'prd_table_rock_buddy','caption',block.text,'Children and families','engagement','warm','medium','story','approved','imported',t,t).run(); changed++;
    }else if(found.text!==block.text){
      await env.DB.prepare(`UPDATE copy_items SET text=?,updated_at=? WHERE id=?`).bind(block.text,t,id).run(); changed++;
    }
  }
  await setSetting(env,'drive_copy_bank',{file_id:doc.id,title:COPY_BANK_TITLE,blocks:blocks.length,last_synced_at:t});
  return {file_id:doc.id,blocks:blocks.length,changed};
}

async function sha256Hex(bytes){
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

function safeName(name){return String(name||'creative').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,180);}

async function downloadDriveFile(token,file){
  const r=await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`,{headers:{authorization:`Bearer ${token}`}});
  if(!r.ok)throw new Error(`Google Drive media download failed for ${file.name} (${r.status})`);
  const bytes=await r.arrayBuffer();
  if(bytes.byteLength>DRIVE_MEDIA_MAX_BYTES)throw new Error(`Drive media ${file.name} exceeded the 25 MB safety limit`);
  return bytes;
}

export function productForDriveCreative(file){
  const name=String(file?.name||'').toLowerCase();
  return /\bbuddy\b/.test(name)?'prd_table_rock_buddy':null;
}

export function driveCreativeStatus(file){
  return productForDriveCreative(file)?'approved':'paused';
}

export async function importDriveMedia(env,token,files){
  const previous=await setting(env,'drive_media_inventory',{});
  const inventory={...(previous||{})};
  let imported=0,unchanged=0,skipped=0,failed=0;
  for(const file of files.filter(driveMediaCandidate)){
    const version=`${file.modifiedTime||''}:${file.md5Checksum||''}:${file.size||''}`;
    if(inventory[file.id]?.version===version&&inventory[file.id]?.asset_id){unchanged++;continue;}
    try{
      const bytes=await downloadDriveFile(token,file);
      const dimensions=imageDimensions(bytes,file.mimeType);
      if(!dimensions?.width||!dimensions?.height)throw new Error(`Could not determine image dimensions for ${file.name}; import paused so quota fallback stays safe`);
      const {width,height}=dimensions;
      const hash=await sha256Hex(bytes);
      const dup=await env.DB.prepare(`SELECT id,r2_key,width,height FROM assets WHERE sha256=? LIMIT 1`).bind(hash).first();
      if(dup){
        if((!Number(dup.width)||!Number(dup.height))&&width&&height){
          await env.DB.prepare(`UPDATE assets SET width=?,height=?,updated_at=? WHERE id=?`).bind(width,height,new Date().toISOString(),dup.id).run();
        }
        inventory[file.id]={version,asset_id:dup.id,source_name:file.name,duplicate:true,width,height};unchanged++;continue;
      }
      const aid=`ast_drive_${String(file.id).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80)}`;
      const existing=await env.DB.prepare(`SELECT id,r2_key FROM assets WHERE id=?`).bind(aid).first();
      const key=`drive-source/${file.id}/${safeName(file.name)}`;
      await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:file.mimeType}});
      const t=new Date().toISOString(); const tokenPublic=crypto.randomUUID().replaceAll('-','');
      const productId=productForDriveCreative(file);
      const assetStatus=driveCreativeStatus(file);
      if(existing){
        if(existing.r2_key&&existing.r2_key!==key)try{await env.MEDIA.delete(existing.r2_key);}catch{}
        await env.DB.prepare(`UPDATE assets SET product_id=?,r2_key=?,original_name=?,mime_type=?,size_bytes=?,width=?,height=?,status=?,sha256=?,perceptual_hint=?,updated_at=? WHERE id=?`)
          .bind(productId,key,file.name,file.mimeType,bytes.byteLength,width,height,assetStatus,hash,`drive:${file.id}`,t,aid).run();
      }else{
        await env.DB.prepare(`INSERT INTO assets(id,product_id,r2_key,public_token,original_name,mime_type,size_bytes,width,height,campaign_type,platforms_json,purpose,status,sha256,perceptual_hint,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(aid,productId,key,tokenPublic,file.name,file.mimeType,bytes.byteLength,width,height,'product',JSON.stringify(['facebook','instagram','pinterest','tiktok']),'sale',assetStatus,hash,`drive:${file.id}`,t,t).run();
      }
      inventory[file.id]={version,asset_id:aid,source_name:file.name,r2_key:key,width,height,product_id:productId,status:assetStatus}; imported++;
    }catch(e){
      inventory[file.id]={version,source_name:file.name,error:String(e.message||e).slice(0,240),failed_at:new Date().toISOString()}; failed++;
    }
  }
  skipped=files.length-files.filter(driveMediaCandidate).length;
  await setSetting(env,'drive_media_inventory',inventory);
  if(failed)await health(env,'google-drive-media','yellow',`${failed} Drive creative(s) could not be imported; originals remain untouched and will retry on the next sync.`);
  else await resolveHealth(env,'google-drive-media');
  return {imported,unchanged,skipped,failed,tracked:Object.keys(inventory).length};
}

export async function buildArchive(env){
  const [products,assets,copy,campaigns,posts,sales,healthEvents,connectors,auditEvents,settingsRows]=await Promise.all([
    env.DB.prepare(`SELECT * FROM products ORDER BY created_at`).all(),
    env.DB.prepare(`SELECT id,product_id,original_name,mime_type,size_bytes,width,height,status,sha256,created_at,updated_at FROM assets ORDER BY created_at`).all(),
    env.DB.prepare(`SELECT * FROM copy_items ORDER BY created_at`).all(),
    env.DB.prepare(`SELECT * FROM campaigns ORDER BY generated_at`).all(),
    env.DB.prepare(`SELECT * FROM scheduled_posts ORDER BY scheduled_for`).all(),
    env.DB.prepare(`SELECT * FROM sales_events ORDER BY occurred_at`).all(),
    env.DB.prepare(`SELECT * FROM health_events ORDER BY created_at`).all(),
    env.DB.prepare(`SELECT id,name,connector_type,platform,enabled,priority,cost_cents_per_post,last_success_at,last_error_at,last_error,created_at,updated_at FROM connectors ORDER BY platform,priority`).all(),
    env.DB.prepare(`SELECT * FROM audit_events ORDER BY created_at`).all(),
    env.DB.prepare(`SELECT key,value_json,updated_at FROM settings ORDER BY key`).all()
  ]);
  return {
    schema:'marketing-autopilot-drive-archive-v2',generated_at:new Date().toISOString(),
    products:products.results||[],assets:assets.results||[],copy_items:copy.results||[],campaigns:campaigns.results||[],scheduled_posts:posts.results||[],sales_events:sales.results||[],
    health_events:healthEvents.results||[],connectors:connectors.results||[],audit_events:auditEvents.results||[],settings:settingsRows.results||[]
  };
}

async function upsertArchive(env,token,rootFiles){
  const folder=env.GOOGLE_DRIVE_FOLDER_ID||DEFAULT_DRIVE_FOLDER_ID; const archive=await buildArchive(env); const body=JSON.stringify(archive,null,2); const existing=rootFiles.find(f=>f.name===ARCHIVE_TITLE);
  if(existing){
    const r=await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=media`,{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json; charset=utf-8'},body});
    if(!r.ok)throw new Error(`Google Drive archive update failed (${r.status})`);
    return {file_id:existing.id,updated:true,bytes:body.length};
  }
  const boundary=`ma_${crypto.randomUUID()}`; const metadata=JSON.stringify({name:ARCHIVE_TITLE,parents:[folder],mimeType:'application/json'});
  const multipart=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':`multipart/related; boundary=${boundary}`},body:multipart});
  const data=await r.json().catch(()=>({})); if(!r.ok||!data.id)throw new Error(`Google Drive archive create failed (${r.status})`);
  return {file_id:data.id,created:true,bytes:body.length};
}

export async function syncGoogleDrive(env){
  if(!driveSyncConfigured(env))return {state:'disabled',reason:'Google Drive OAuth secrets are not configured'};
  try{
    const token=await accessToken(env); const folder=env.GOOGLE_DRIVE_FOLDER_ID||DEFAULT_DRIVE_FOLDER_ID;
    const rootFiles=await listChildren(token,folder); const files=[...rootFiles]; const queue=rootFiles.filter(f=>f.mimeType===DRIVE_FOLDER_MIME).map(f=>f.id); const visited=new Set([folder]);
    while(queue.length){
      const folderId=queue.shift();
      if(visited.has(folderId))continue;
      visited.add(folderId);
      if(visited.size>250)throw new Error('Google Drive source exceeded 250 nested folders; sync stopped safely');
      const children=await listChildren(token,folderId); files.push(...children);
      for(const child of children)if(child.mimeType===DRIVE_FOLDER_MIME)queue.push(child.id);
    }
    const imported=await importCopyBank(env,token,files);
    const media=await importDriveMedia(env,token,files);
    const archive=await upsertArchive(env,token,rootFiles);
    await setSetting(env,'drive_sync_status',{folder_id:folder,last_success_at:new Date().toISOString(),source_files:files.length,copy_blocks:imported.blocks,copy_changed:imported.changed,media_imported:media.imported,media_failed:media.failed,archive_file_id:archive.file_id});
    await resolveHealth(env,'google-drive');
    return {state:'synced',source_files:files.length,imported,media,archive};
  }catch(e){
    await health(env,'google-drive','yellow',`Drive sync failed: ${String(e.message||e).slice(0,300)}`);
    throw e;
  }
}
