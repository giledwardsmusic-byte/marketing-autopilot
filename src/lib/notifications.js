import { nowIso } from './utils.js';

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

async function alreadySent(env,key){
  const row=await env.DB.prepare(`SELECT value_json FROM settings WHERE key=?`).bind(`notification:${key}`).first();
  return Boolean(row);
}

async function markSent(env,key,meta={}){
  const t=nowIso();
  await env.DB.prepare(`INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
    .bind(`notification:${key}`,JSON.stringify({sent_at:t,...meta}),t).run();
}

export function alertEmailConfigured(env){
  return Boolean(env.RESEND_API_KEY&&env.ALERT_EMAIL_TO&&env.ALERT_EMAIL_FROM);
}

export async function sendAlertOnce(env,{key,subject,text,html}){
  if(!key)throw new Error('notification key is required');
  if(await alreadySent(env,key))return {state:'duplicate'};
  if(!alertEmailConfigured(env))return {state:'disabled',reason:'RESEND_API_KEY, ALERT_EMAIL_TO and ALERT_EMAIL_FROM are required'};
  const body={from:env.ALERT_EMAIL_FROM,to:[env.ALERT_EMAIL_TO],subject:String(subject||'Marketing Autopilot alert'),text:String(text||''),html:html||`<pre style="white-space:pre-wrap;font-family:system-ui">${esc(text||'')}</pre>`};
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${env.RESEND_API_KEY}`,'content-type':'application/json'},body:JSON.stringify(body)});
  let data={};try{data=await r.json()}catch{}
  if(!r.ok)throw new Error(`Resend ${r.status}: ${data?.message||JSON.stringify(data)}`);
  await markSent(env,key,{provider:'resend',provider_id:data?.id||null});
  return {state:'sent',id:data?.id||null};
}

export async function notifyPaidSale(env,payload){
  if(payload?.type!=='paid'||!payload?.id)return {state:'ignored'};
  const amount=Number(payload.price||0);
  const currency=String(payload.currency||'').toUpperCase();
  const itemNames=(Array.isArray(payload.items)?payload.items:[]).map(x=>x?.product_name).filter(Boolean).join(', ');
  const text=`A Payhip sale was recorded.\n\nProduct: ${itemNames||'Table Rock Press product'}\nAmount: ${currency?currency+' ':''}${(amount/100).toFixed(2)}\nTransaction: ${payload.id}`;
  return sendAlertOnce(env,{key:`sale:payhip:${payload.id}`,subject:`Sale: ${itemNames||'Payhip order'}`,text});
}

export async function notifyUnresolvedHealth(env){
  const rows=(await env.DB.prepare(`SELECT id,component,severity,message,created_at FROM health_events WHERE resolved=0 ORDER BY CASE severity WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END,created_at ASC LIMIT 50`).all()).results||[];
  const out=[];
  for(const row of rows){
    const text=`Marketing Autopilot needs attention.\n\nSeverity: ${row.severity}\nIssue: ${row.component}\n${row.message||''}\nDetected: ${row.created_at||''}`;
    try{out.push(await sendAlertOnce(env,{key:`health:${row.id}`,subject:`Marketing Autopilot ${String(row.severity||'alert').toUpperCase()}: ${row.component}`,text}));}
    catch(e){out.push({state:'failed',error:String(e.message||e)});}
  }
  return out;
}
