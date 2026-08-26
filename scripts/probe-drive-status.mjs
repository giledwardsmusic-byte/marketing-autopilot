const base=(process.env.MA_BASE_URL||'').replace(/\/$/,'');
if(!base) throw new Error('MA_BASE_URL is required');
const r=await fetch(`${base}/system/drive-status`,{headers:{accept:'application/json'}});
const text=await r.text();
if(!r.ok) throw new Error(`Drive status probe failed (${r.status}): ${text.slice(0,500)}`);
let data;
try{data=JSON.parse(text);}catch{throw new Error(`Drive status returned invalid JSON: ${text.slice(0,500)}`);}
console.log('Live Drive status:',JSON.stringify(data));
