const TOKEN_KEY='ma_session_token';
function token(){return localStorage.getItem(TOKEN_KEY)||'';}
async function api(path,opts={}){
  const headers={...(opts.headers||{}),'content-type':'application/json'};
  if(token())headers.authorization=`Bearer ${token()}`;
  const r=await fetch(path,{...opts,credentials:'same-origin',headers});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);
  return data;
}
function toast(msg){const t=document.querySelector('#toast');if(!t)return;t.textContent=msg;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),3200);}
async function injectInstagramButton(){
  const main=document.querySelector('#main');
  if(!main||document.querySelector('#connectInstagram'))return;
  const heading=[...main.querySelectorAll('h2')].find(h=>h.textContent.trim()==='Publishing connections');
  if(!heading)return;
  let connectors=[];try{connectors=await api('/api/connectors');}catch{return;}
  const ig=connectors.some(c=>c.platform==='instagram'&&c.connector_type==='meta_instagram'&&Number(c.enabled)===1);
  const fb=connectors.some(c=>c.platform==='facebook'&&c.connector_type==='meta_facebook'&&Number(c.enabled)===1);
  const wrap=document.createElement('div');wrap.style.marginBottom='16px';
  if(ig)wrap.innerHTML='<button id="connectInstagram" class="btn" disabled>Instagram connected</button>';
  else if(!fb)wrap.innerHTML='<button id="connectInstagram" class="btn" disabled>Connect Facebook first</button>';
  else wrap.innerHTML='<button id="connectInstagram" class="btn primary">Connect Instagram</button><p id="igConnectResult" class="notice"></p>';
  heading.insertAdjacentElement('afterend',wrap);
  const btn=document.querySelector('#connectInstagram');
  if(!ig&&fb&&btn)btn.onclick=async()=>{
    btn.disabled=true;const out=document.querySelector('#igConnectResult');out.textContent='Connecting through Table Rock Press Facebook…';
    try{const r=await api('/api/connectors/instagram/from-facebook',{method:'POST',body:'{}'});out.textContent=r.username?`Connected @${r.username}.`:'Instagram connected.';toast('Instagram connected');setTimeout(()=>document.querySelector('[data-tab="settings"]')?.click(),600);}
    catch(e){out.textContent=e.message;btn.disabled=false;}
  };
}
const observer=new MutationObserver(()=>injectInstagramButton());
observer.observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('load',injectInstagramButton);setTimeout(injectInstagramButton,700);
