const TOKEN_KEY='ma_session_token';
function token(){return localStorage.getItem(TOKEN_KEY)||'';}
function config(c){try{return JSON.parse(c?.config_json||'{}')}catch{return {}}}
async function api(path,opts={}){
  const headers={...(opts.headers||{}),'content-type':'application/json'};
  if(token())headers.authorization=`Bearer ${token()}`;
  const r=await fetch(path,{...opts,credentials:'same-origin',headers});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);
  return data;
}
async function injectInstagramButton(){
  const main=document.querySelector('#main'); if(!main)return;
  const heading=[...main.querySelectorAll('h2')].find(h=>h.textContent.trim()==='Publishing connections'); if(!heading)return;
  main.querySelectorAll('[data-ma-connector="instagram"]').forEach((el,i)=>{if(i)el.remove()});
  if(main.querySelector('[data-ma-connector="instagram"]'))return;
  let connectors=[];try{connectors=await api('/api/connectors');}catch{return;}
  const ig=connectors.some(c=>{
    if(c.platform!=='instagram'||c.connector_type!=='meta_instagram'||Number(c.enabled)!==1)return false;
    const cfg=config(c);
    return String(cfg.username||'').toLowerCase()==='tablerockpress'&&String(cfg.host||'').replace(/\/$/,'')==='https://graph.instagram.com';
  });
  const wrap=document.createElement('div');wrap.dataset.maConnector='instagram';wrap.style.marginBottom='16px';
  if(ig)wrap.innerHTML='<button id="connectInstagram" class="btn" disabled>Instagram @tablerockpress connected</button>';
  else wrap.innerHTML='<button id="connectInstagram" class="btn primary">Connect Instagram @tablerockpress</button><p id="igConnectResult" class="notice"></p>';
  heading.insertAdjacentElement('afterend',wrap);
  const btn=wrap.querySelector('#connectInstagram');
  if(!ig&&btn)btn.onclick=()=>{btn.disabled=true;const out=wrap.querySelector('#igConnectResult');out.textContent='Opening Instagram authorization…';window.location.assign('/api/connectors/instagram/oauth/start');};
}
const observer=new MutationObserver(()=>injectInstagramButton());observer.observe(document.documentElement,{subtree:true,childList:true});window.addEventListener('load',injectInstagramButton);setTimeout(injectInstagramButton,700);
