const base=(process.env.MA_BASE_URL||'').replace(/\/$/,'');
if(!base) throw new Error('MA_BASE_URL is required');
const r=await fetch(`${base}/system/drive-status`,{headers:{accept:'application/json'}});
const text=await r.text();
if(!r.ok) throw new Error(`Drive status probe failed (${r.status}): ${text.slice(0,500)}`);
let data;
try{data=JSON.parse(text);}catch{throw new Error(`Drive status returned invalid JSON: ${text.slice(0,500)}`);}
if(!data.configured) throw new Error('Live Google Drive is not configured');
const s=data.sync_status||{};
if(!s.last_success_at) throw new Error('Live Google Drive has not completed a successful sync');
if(!s.archive_file_id) throw new Error('Live Google Drive sync did not create/update the archive file');
if(Number(s.media_failed||0)!==0) throw new Error(`Live Google Drive sync has ${s.media_failed} failed media import(s)`);
if(Number(s.copy_blocks||0)<1) throw new Error('Live Marketing Copy Bank did not import any copy blocks');
console.log('Live Drive status:',JSON.stringify(data));
