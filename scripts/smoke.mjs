const base=(process.env.MA_BASE_URL||'http://localhost:8787').replace(/\/$/,'');
const email=process.env.MA_EMAIL, password=process.env.MA_PASSWORD;
if(!email||!password) throw new Error('Set MA_EMAIL and MA_PASSWORD');
let cookie='';
async function req(path,opts={}){const h={...(opts.headers||{})};if(cookie)h.cookie=cookie;if(opts.body&&!(opts.body instanceof FormData)&&typeof opts.body!=='string'){h['content-type']='application/json';opts.body=JSON.stringify(opts.body)}const r=await fetch(base+path,{...opts,headers:h,redirect:'manual'});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];let data={};try{data=await r.json()}catch{}if(!r.ok)throw new Error(`${path} ${r.status}: ${JSON.stringify(data)}`);return data}
const checks=[];const ok=(name,cond)=>{if(!cond)throw new Error(`FAILED: ${name}`);checks.push(name)};
const login=await req('/api/auth/login',{method:'POST',body:{email,password}});ok('login',!!login.user);
const p=await req('/api/products',{method:'POST',body:{name:`Smoke Product ${Date.now()}`,product_type:'digital',short_description:'Temporary smoke-test product',sales_url:'https://example.com',status:'active'}});ok('product create',!!p.id);
const products=await req('/api/products');ok('product read',products.some(x=>x.id===p.id));
await req('/api/copy',{method:'POST',body:{product_id:p.id,text:'Temporary smoke-test marketing copy.',platform:'facebook'}});const copy=await req('/api/copy');ok('copy create/read',copy.some(x=>x.product_id===p.id));
const blob=new Blob(['fake image bytes'],{type:'image/png'});const f1=new FormData();f1.set('product_id',p.id);f1.set('status','approved');f1.append('files',blob,'smoke.png');const u1=await req('/api/assets/upload',{method:'POST',body:f1});ok('asset upload',u1.items?.length===1);
const f2=new FormData();f2.set('product_id',p.id);f2.set('status','approved');f2.append('files',blob,'renamed-smoke.png');const u2=await req('/api/assets/upload',{method:'POST',body:f2});ok('exact duplicate detection',u2.items?.[0]?.duplicate===true);
const settings=await req('/api/settings');ok('cost ceiling exists',Number(settings.cost_control?.approved_monthly_cost_cents)>=0);ok('timezone exists',!!settings.marketing_timezone?.iana);
console.log(`Smoke checks passed (${checks.length}):\n- ${checks.join('\n- ')}`);
