const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const state={tab:'dashboard',user:null,weekStart:null,products:[],assets:[],copy:[],dashboard:null};
const TOKEN_KEY='ma_session_token';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(c)||0)/100);
const dt=s=>s?new Date(s).toLocaleString():'—';
const token=()=>localStorage.getItem(TOKEN_KEY)||'';
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.add('hidden'),3200)}
function showLogin(){ $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); }
function showApp(){ $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); }
async function api(path,opts={}){
  const headers={...(opts.body instanceof FormData?{}:{'content-type':'application/json'}),...(opts.headers||{})};
  if(token())headers.authorization=`Bearer ${token()}`;
  const init={...opts,credentials:'same-origin',headers};
  if(init.body&&!(init.body instanceof FormData)&&typeof init.body!=='string')init.body=JSON.stringify(init.body);
  const r=await fetch(path,init); let data={}; try{data=await r.json()}catch{}
  if(r.status===401){localStorage.removeItem(TOKEN_KEY);showLogin();throw new Error('Session expired. Sign in once more.');}
  if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);
  return data;
}
function nextMonday(){const d=new Date(),day=d.getUTCDay(),add=((8-day)%7)||7;d.setUTCDate(d.getUTCDate()+add);d.setUTCHours(0,0,0,0);return d.toISOString()}
function openModal(html){$('#modalBody').innerHTML=html;$('#modal').showModal();$('#closeModal')?.addEventListener('click',()=>$('#modal').close())}
$('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))$('#modal').close()});

async function refreshStatus(){
  try{
    const [d,a]=await Promise.all([api('/api/dashboard'),api('/api/needs-attention')]); state.dashboard=d;
    const health=d.health||[], failed=(a.failed||[]).length, issues=health.length+failed;
    const severity=health.some(x=>x.severity==='red')?'red':issues?'yellow':'green';
    $('#healthOrb').className=`orb ${severity}`;
    $('#healthLabel').textContent=issues?`${issues} item${issues===1?'':'s'} need attention`:'All systems normal';
    $('#attnDot').classList.toggle('hidden',issues===0);
  }catch{}
}

async function render(){
  const main=$('#main'); main.innerHTML='<div class="empty">Loading…</div>';
  try{
    await refreshStatus();
    if(state.tab==='dashboard')return dashboard(main);
    if(state.tab==='week')return week(main);
    if(state.tab==='products')return products(main);
    if(state.tab==='library')return library(main);
    if(state.tab==='performance')return performance(main);
    if(state.tab==='attention')return attention(main);
    if(state.tab==='settings')return settings(main);
  }catch(e){main.innerHTML=`<div class="card"><div class="empty bad">${esc(e.message)}</div></div>`}
}

async function dashboard(main){
  const d=state.dashboard||await api('/api/dashboard');
  let top=null; try{const p=await api('/api/performance');top=(p.byProduct||[]).find(x=>Number(x.revenue_cents||0)>0)||(p.byProduct||[]).find(x=>Number(x.clicks||0)>0)}catch{}
  main.innerHTML=`
    <section class="card"><h2>Last 30 days</h2><div class="grid2">
      <div class="metric"><div class="num">${money(d.metrics?.revenue_cents)}</div><div class="lbl">Attributed revenue</div></div>
      <div class="metric"><div class="num">${Number(d.metrics?.clicks||0).toLocaleString()}</div><div class="lbl">Clicks</div></div>
      <div class="metric"><div class="num">${Number(d.metrics?.conversions||0)}</div><div class="lbl">Conversions</div></div>
      <div class="metric"><div class="num">${Number(d.products?.active||0)}</div><div class="lbl">Active products</div></div>
    </div></section>
    <section class="card"><h2>What's working</h2>${top?`<p><strong>${esc(top.name||top.platform)}</strong> is currently leading tracked performance with ${money(top.revenue_cents)} revenue and ${Number(top.clicks||0)} clicks.</p>`:'<div class="empty">Not enough performance data yet. This fills in automatically as campaigns run.</div>'}</section>
    <section class="card"><h2>Spending this month</h2><p class="mono" style="font-size:20px;margin:6px 0">${money(d.monthly_cost_cents)}</p><p class="muted small">Approved ceiling: ${money(d.cost_ceiling_cents)}. Nothing paid is allowed above your approved limit.</p></section>
    <section class="card"><h2>Generate next week's plan</h2><p class="muted small">Autopilot builds the schedule from your active products, graphics and reusable copy. Review it under This Week.</p><button id="generateWeek" class="btn primary">Generate weekly plan</button><p id="genResult" class="notice"></p></section>`;
  $('#generateWeek').onclick=async()=>{const o=$('#genResult');o.textContent='Working…';try{const start=nextMonday();state.weekStart=start;const r=await api('/api/campaigns/generate',{method:'POST',body:{week_start:start}});o.textContent=r.reused?'That week is already built.':`Built ${r.count||0} scheduled posts.`;await refreshStatus()}catch(e){o.textContent=e.message}};
}

async function week(main){
  const start=state.weekStart||nextMonday();state.weekStart=start;const w=await api(`/api/week?start=${encodeURIComponent(start)}`),posts=w.posts||[];
  const approvable=posts.filter(p=>['scheduled','planned','paused'].includes(p.status)).length;
  main.innerHTML=`<section class="card"><div class="row between"><div><h2>Week of ${new Date(start).toLocaleDateString()}</h2><div class="muted small">Review only what you want. Autopilot keeps the rest moving.</div></div>${posts.length?`<button id="approveWeek" class="btn primary">Approve entire week</button>`:`<button id="buildWeek" class="btn primary">Build this week</button>`}</div>${posts.length?`<p class="notice">${approvable} post${approvable===1?'':'s'} ready for approval.</p>`:''}</section><section class="card" id="weekPosts"><h2>Scheduled posts (${posts.length})</h2>${posts.length?'':'<div class="empty">No campaign yet.</div>'}</section>`;
  if(!posts.length){$('#buildWeek').onclick=async()=>{const r=await api('/api/campaigns/generate',{method:'POST',body:{week_start:start}});toast(`Built ${r.count||0} posts`);await week(main)};return}
  $('#approveWeek').onclick=async()=>{const r=await api('/api/week/approve',{method:'POST',body:{week_start:start}});toast(`Approved ${r.approved||0} posts`);await week(main)};
  const box=$('#weekPosts'); for(const p of posts){const div=document.createElement('div');div.className='post-item';div.innerHTML=`${p.public_token?`<img class="post-thumb" src="/public-media/${p.public_token}" alt="">`:'<div class="post-thumb"></div>'}<div class="post-body"><div class="post-meta">${esc(p.platform)} · ${dt(p.scheduled_for)} · <span class="badge ${esc(p.status)}">${esc(p.status)}</span></div><div class="strong">${esc(p.product_name||'Product')}</div><div class="post-copy">${esc(p.caption||'')}</div><div class="post-actions"><button class="btn primary" data-action="approved" data-id="${p.id}">Approve</button><button class="btn" data-edit="${p.id}">Edit</button><button class="btn" data-action="paused" data-id="${p.id}">Pause</button><button class="btn danger" data-action="rejected" data-id="${p.id}">Reject</button></div></div>`;box.appendChild(div)}
  $$('[data-action]').forEach(b=>b.onclick=async()=>{await api(`/api/posts/${b.dataset.id}`,{method:'PATCH',body:{status:b.dataset.action}});await week(main)});
  $$('[data-edit]').forEach(b=>{const p=posts.find(x=>x.id===b.dataset.edit);b.onclick=()=>editPost(p,main)});
}
function editPost(p,main){openModal(`<div class="row between"><h2 style="margin:0">Edit post</h2><button id="closeModal" class="btn ghost">Close</button></div><label>Caption</label><textarea id="editCaption">${esc(p.caption||'')}</textarea><label>Scheduled time</label><input id="editTime" type="datetime-local" value="${p.scheduled_for?new Date(p.scheduled_for).toISOString().slice(0,16):''}"><button id="savePost" class="btn primary wide">Save changes</button>`);$('#savePost').onclick=async()=>{await api(`/api/posts/${p.id}`,{method:'PATCH',body:{caption:$('#editCaption').value,scheduled_for:new Date($('#editTime').value).toISOString()}});$('#modal').close();toast('Post updated');await week(main)}}

async function products(main){state.products=await api('/api/products');main.innerHTML=`<section class="card"><h2>Add a product</h2><div class="form-grid"><div><label>Name</label><input id="prodName"></div><div><label>Type</label><select id="prodType"><option>book</option><option>app</option><option>music</option><option>digital</option><option>other</option></select></div><div class="full"><label>Sales URL</label><input id="prodUrl" placeholder="https://..."></div></div><button id="addProduct" class="btn primary">Add product</button><p id="prodResult" class="notice"></p></section><section class="card" id="productList"><h2>Products (${state.products.length})</h2>${state.products.length?'':'<div class="empty">No products yet.</div>'}</section>`;
  $('#addProduct').onclick=async()=>{const name=$('#prodName').value.trim();if(!name)return $('#prodResult').textContent='Name is required.';try{await api('/api/products',{method:'POST',body:{name,product_type:$('#prodType').value,sales_url:$('#prodUrl').value||null,status:'active'}});toast('Product added');await products(main)}catch(e){$('#prodResult').textContent=e.message}};
  const list=$('#productList'); for(const p of state.products){const d=document.createElement('div');d.className='post-item';d.innerHTML=`<div class="post-body"><div class="post-meta">${esc(p.product_type||'product')} · <span class="badge ${esc(p.status)}">${esc(p.status)}</span> · ${p.asset_count||0} graphics · ${p.copy_count||0} copy</div><div class="strong">${esc(p.name)}</div><div class="post-actions">${p.status==='active'?`<button class="btn" data-status="paused" data-id="${p.id}">Pause</button>`:`<button class="btn primary" data-status="active" data-id="${p.id}">Activate</button>`}<button class="btn" data-edit-product="${p.id}">Edit</button><button class="btn danger" data-status="retired" data-id="${p.id}">Retire</button></div></div>`;list.appendChild(d)}
  $$('[data-status]').forEach(b=>b.onclick=async()=>{await api(`/api/products/${b.dataset.id}`,{method:'PATCH',body:{status:b.dataset.status}});await products(main)});$$('[data-edit-product]').forEach(b=>{const p=state.products.find(x=>x.id===b.dataset.editProduct);b.onclick=()=>editProduct(p,main)});
}
function editProduct(p,main){openModal(`<div class="row between"><h2 style="margin:0">Edit product</h2><button id="closeModal" class="btn ghost">Close</button></div><label>Name</label><input id="epName" value="${esc(p.name)}"><label>Sales URL</label><input id="epUrl" value="${esc(p.sales_url||'')}"><label>Short description</label><textarea id="epDesc">${esc(p.short_description||'')}</textarea><button id="saveProduct" class="btn primary wide">Save product</button>`);$('#saveProduct').onclick=async()=>{await api(`/api/products/${p.id}`,{method:'PATCH',body:{name:$('#epName').value,sales_url:$('#epUrl').value,short_description:$('#epDesc').value}});$('#modal').close();toast('Product saved');await products(main)}}

async function library(main){const [productsData,assets,copy]=await Promise.all([api('/api/products'),api('/api/assets'),api('/api/copy')]);state.products=productsData;state.assets=assets;state.copy=copy;main.innerHTML=`<section class="card"><h2>Upload graphics</h2><label>Assign to product (optional)</label><select id="uploadProduct"><option value="">Let the system classify it</option>${state.products.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><input id="uploadFiles" type="file" multiple accept="image/*"><button id="uploadBtn" class="btn primary">Upload graphics</button><p id="uploadResult" class="notice"></p></section><section class="card"><div class="row between"><h2>Graphics (${assets.length})</h2><span class="muted small">Rotated by usage</span></div>${assets.length?`<div class="asset-grid">${assets.map(a=>`<div class="asset"><img src="/public-media/${a.public_token}" alt=""><div class="body"><div class="name">${esc(a.product_name||a.original_name||'Unassigned')}</div><div class="meta">used ${a.use_count||0}x · ${esc(a.status)}</div></div></div>`).join('')}</div>`:'<div class="empty">No graphics yet.</div>'}</section><section class="card"><div class="row between"><h2>Reusable copy (${copy.length})</h2><button id="addCopy" class="btn">Add copy</button></div>${copy.length?copy.slice(0,50).map(c=>`<div class="post-item"><div class="post-body"><div class="post-meta">${esc(c.product_name||'General')} · ${esc(c.platform||'any platform')} · used ${c.use_count||0}x</div><div class="post-copy">${esc(c.text)}</div></div></div>`).join(''):'<div class="empty">No reusable copy yet.</div>'}</section>`;
  $('#uploadBtn').onclick=async()=>{const files=$('#uploadFiles').files;if(!files.length)return $('#uploadResult').textContent='Choose at least one image.';const form=new FormData();for(const f of files)form.append('files',f);if($('#uploadProduct').value)form.append('product_id',$('#uploadProduct').value);form.append('status','approved');$('#uploadResult').textContent='Uploading…';try{const r=await api('/api/assets/upload',{method:'POST',body:form});const dup=r.items.filter(x=>x.duplicate).length;toast(`Uploaded ${r.items.length-dup}; ${dup} duplicates skipped`);await library(main)}catch(e){$('#uploadResult').textContent=e.message}};
  $('#addCopy').onclick=()=>copyModal(main);
}
function copyModal(main){openModal(`<div class="row between"><h2 style="margin:0">Add reusable copy</h2><button id="closeModal" class="btn ghost">Close</button></div><label>Product</label><select id="copyProduct"><option value="">General</option>${state.products.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><label>Platform</label><select id="copyPlatform"><option value="">Any</option><option>facebook</option><option>instagram</option><option>tiktok</option><option>pinterest</option><option>email</option></select><label>Copy</label><textarea id="copyText"></textarea><button id="saveCopy" class="btn primary wide">Save copy</button>`);$('#saveCopy').onclick=async()=>{if(!$('#copyText').value.trim())return;await api('/api/copy',{method:'POST',body:{product_id:$('#copyProduct').value||null,platform:$('#copyPlatform').value||null,text:$('#copyText').value}});$('#modal').close();toast('Copy added');await library(main)}}

async function performance(main){const p=await api('/api/performance');const table=(rows,key)=>rows?.length?`<div class="table-wrap"><table><thead><tr><th>${key==='name'?'Product':'Platform'}</th><th>Impr.</th><th>Clicks</th><th>Conv.</th><th>Revenue</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r[key]||'Unknown')}</td><td>${Number(r.impressions||0).toLocaleString()}</td><td>${Number(r.clicks||0)}</td><td>${Number(r.conversions||0)}</td><td>${money(r.revenue_cents)}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">No performance data yet.</div>';main.innerHTML=`<section class="card"><h2>By product</h2>${table(p.byProduct,'name')}</section><section class="card"><h2>By platform</h2>${table(p.byPlatform,'platform')}</section>`}

async function attention(main){const a=await api('/api/needs-attention'),health=a.health||[],failed=a.failed||[];main.innerHTML=`<section class="card"><h2>Needs attention (${health.length+failed.length})</h2>${!health.length&&!failed.length?'<div class="empty">Nothing needs you right now.</div>':''}${health.map(h=>`<div class="post-item"><div class="post-body"><div class="post-meta"><span class="badge ${esc(h.severity)}">${esc(h.severity)}</span> ${esc(h.component||'system')}</div><div class="post-copy">${esc(h.message)}</div></div></div>`).join('')}${failed.map(p=>`<div class="post-item"><div class="post-body"><div class="post-meta"><span class="badge failed">failed</span> ${esc(p.platform)} · ${esc(p.product_name||'Product')}</div><div class="post-copy bad">${esc(p.error_message||'Unknown publishing error')}</div></div></div>`).join('')}</section>`}

async function settings(main){const [s,connectors,users]=await Promise.all([api('/api/settings'),api('/api/connectors'),api('/api/users')]);main.innerHTML=`<section class="card"><h2>Autopilot</h2><div class="row between"><div><div class="strong">${s.autopilot?.enabled?'Running':'Paused'}</div><div class="muted small">Marketing can continue without weekly approval.</div></div><button id="toggleAuto" class="btn ${s.autopilot?.enabled?'':'primary'}">${s.autopilot?.enabled?'Pause':'Start'}</button></div></section><section class="card"><h2>Cost protection</h2><label>Approved monthly automation cost ($)</label><input id="costCeiling" type="number" min="0" step="1" value="${Number(s.cost_control?.approved_monthly_cost_cents||0)/100}"><button id="saveCost" class="btn">Save limit</button><p class="notice">Paid routes above this ceiling are blocked automatically.</p></section><section class="card"><h2>Publishing connections</h2>${connectors.length?connectors.map(c=>`<div class="post-item"><div class="post-body"><div class="strong">${esc(c.platform)} → ${esc(c.name)}</div><div class="post-meta">${esc(c.connector_type)} · priority ${c.priority} · ${c.enabled?'enabled':'off'}</div></div></div>`).join(''):'<div class="empty">No publishing routes connected yet.</div>'}</section><section class="card"><h2>Administrators</h2>${users.map(u=>`<div class="post-item"><div class="post-body"><div class="strong">${esc(u.email)}</div><div class="post-meta">${esc(u.role)} · ${esc(u.status)}</div></div></div>`).join('')}</section>`;$('#toggleAuto').onclick=async()=>{await api('/api/settings',{method:'PATCH',body:{autopilot:{...s.autopilot,enabled:!s.autopilot?.enabled}}});await settings(main)};$('#saveCost').onclick=async()=>{await api('/api/settings',{method:'PATCH',body:{cost_control:{...s.cost_control,approved_monthly_cost_cents:Math.round(Number($('#costCeiling').value||0)*100)}}});toast('Cost limit saved')};}

$$('.tabs button').forEach(btn=>btn.addEventListener('click',async()=>{$$('.tabs button').forEach(b=>b.classList.remove('active'));btn.classList.add('active');state.tab=btn.dataset.tab;await render()}));
$('#signout').onclick=async()=>{try{await api('/api/auth/logout',{method:'POST'})}catch{}localStorage.removeItem(TOKEN_KEY);location.reload()};
$('#loginForm').onsubmit=async e=>{e.preventDefault();const err=$('#loginError');err.textContent='';try{const email=$('#loginEmail').value.trim();const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:$('#loginPassword').value}),credentials:'same-origin'});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Invalid email or password.');const sessionToken=data?.user?.session_token;if(!sessionToken)throw new Error('Login succeeded but no session token was returned.');localStorage.setItem(TOKEN_KEY,sessionToken);localStorage.setItem('ma_login_email',email);state.user=data.user;showApp();await render()}catch(e){err.textContent=e.message}};
$('#bootstrapBtn').onclick=async()=>{try{await api('/api/auth/bootstrap',{method:'POST'});location.reload()}catch(e){$('#loginError').textContent=e.message}};

(async function init(){
  const savedEmail=localStorage.getItem('ma_login_email');if(savedEmail)$('#loginEmail').value=savedEmail;
  try{
    const status=await fetch('/api/auth/status').then(r=>r.json());
    if(!status.initialized){showLogin();$('#loginForm').classList.add('hidden');$('#bootstrapBtn').classList.remove('hidden');$('#loginNote').textContent='One-time owner setup is ready.';return}
    if(!token()){showLogin();return}
    const me=await api('/api/auth/me');state.user=me.user;showApp();await render();
  }catch{showLogin()}
})();
