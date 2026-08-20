import { id, nowIso, parseJSON } from './utils.js';
import { setting } from './db.js';

function verifiedProductContext(p) {
  return JSON.stringify({name:p.name,type:p.product_type,brand:p.brand,short_description:p.short_description,full_description:p.full_description,audience:p.audience,features:parseJSON(p.features_json,[]),benefits:parseJSON(p.benefits_json,[]),price_cents:p.price_cents,currency:p.currency,sales_url:p.sales_url,freebie_url:p.freebie_url});
}
async function remainingBudget(env){
  const ctl=await setting(env,'cost_control',{approved_monthly_cost_cents:0,ai_estimated_cents_per_call:1});
  const row=await env.DB.prepare(`SELECT COALESCE(SUM(amount_cents),0) used FROM cost_usage WHERE period=strftime('%Y-%m','now')`).first();
  return {remaining:Number(ctl.approved_monthly_cost_cents||0)-Number(row?.used||0),estimated:Number(ctl.ai_estimated_cents_per_call||1)};
}
async function chargeEstimate(env,provider,cents){ if(cents>0) await env.DB.prepare(`INSERT INTO cost_usage(id,category,provider,amount_cents,units,period,recorded_at) VALUES(?,?,?,?,1,strftime('%Y-%m','now'),?)`).bind(id('cost'),'ai',provider,cents,nowIso()).run(); }

async function openAI(env, prompt, image=null) {
  if(!env.OPENAI_API_KEY || !env.AI_MODEL) throw new Error('OpenAI key/model not configured');
  let input=prompt;
  if(image) input=[{role:'user',content:[{type:'input_text',text:prompt},{type:'input_image',image_url:`data:${image.mime};base64,${image.base64}`}] }];
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${env.OPENAI_API_KEY}`},body:JSON.stringify({model:env.AI_MODEL,input})});
  if(!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  const data=await r.json(); return data.output_text || data.output?.flatMap(x=>x.content||[]).map(x=>x.text||'').join('') || '';
}
async function anthropic(env, prompt, image=null) {
  if(!env.ANTHROPIC_API_KEY || !env.AI_MODEL) throw new Error('Anthropic key/model not configured');
  const content=image?[{type:'image',source:{type:'base64',media_type:image.mime,data:image.base64}},{type:'text',text:prompt}]:prompt;
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:env.AI_MODEL,max_tokens:900,messages:[{role:'user',content}]})});
  if(!r.ok) throw new Error(`Anthropic ${r.status}: ${await r.text()}`);
  const data=await r.json(); return (data.content||[]).map(x=>x.text||'').join('');
}
async function paidCall(env,prompt,image=null){
  const provider=(env.AI_PROVIDER||'none').toLowerCase(); const budget=await remainingBudget(env);
  if(!['openai','anthropic'].includes(provider) || budget.remaining<budget.estimated) return {provider:'system',text:null,cost:0};
  const text=provider==='openai'?await openAI(env,prompt,image):await anthropic(env,prompt,image); await chargeEstimate(env,provider,budget.estimated); return {provider,text,cost:budget.estimated};
}
export async function generateCopy(env, product, {platform='facebook',purpose='sale',tone='clear, warm, direct',assetMessage='' }={}) {
  const prompt=`You are writing advertising copy for a verified product. Use ONLY the facts in PRODUCT_JSON. Never invent reviews, testimonials, awards, prices, capabilities, customer quotes, scarcity, or results. Write one natural social caption for ${platform}. Purpose: ${purpose}. Tone: ${tone}. ${assetMessage?`The graphic message is: ${assetMessage}`:''}\nPRODUCT_JSON=${verifiedProductContext(product)}\nReturn only the caption text.`;
  const call=await paidCall(env,prompt); let text=call.text;
  if(!text){const benefit=(parseJSON(product.benefits_json,[])[0]||product.short_description||'').trim(); text=`${product.name}${benefit?`: ${benefit}`:''}`;}
  await env.DB.prepare(`INSERT INTO ai_generations(id,provider,model,purpose,product_id,input_summary,output_text,verified,estimated_cost_cents,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id('ai'),call.provider,env.AI_MODEL||'',`copy:${platform}:${purpose}`,product.id,'Verified product facts only',text,1,call.cost,nowIso()).run();
  return text.trim();
}
export async function classifyAsset(env,{bytes,mime,filename,products}){
  const base={campaign_type:/review|testimonial/i.test(filename)?'review':/giveaway|free/i.test(filename)?'giveaway':/quote/i.test(filename)?'quote':'product',theme:'',audience:'',platforms:[],has_qr:/qr/i.test(filename),has_testimonial:/review|testimonial/i.test(filename),main_message:'',purpose:'sale',product_id:null,source:'heuristic'};
  if(!mime?.startsWith('image/') || bytes.byteLength>8_000_000) return base;
  const prompt=`Analyze this advertising graphic and classify it. Candidate products: ${JSON.stringify(products.map(p=>({id:p.id,name:p.name,brand:p.brand})))}. Return STRICT JSON only with keys: product_id (one candidate id or null), campaign_type, theme, audience, platforms (array chosen from facebook,instagram,tiktok,pinterest,email), has_qr (boolean), has_testimonial (boolean), main_message, purpose. Do not invent product facts.`;
  const b64=btoa(String.fromCharCode(...new Uint8Array(bytes))); const call=await paidCall(env,prompt,{mime,base64:b64}); if(!call.text)return base;
  try{const raw=call.text.replace(/^```json\s*|\s*```$/g,'').trim(),x=JSON.parse(raw); return {...base,...x,source:'ai'};}catch{return base;}
}
