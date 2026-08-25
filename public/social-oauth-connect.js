const TOKEN_KEY='ma_session_token';
function token(){return localStorage.getItem(TOKEN_KEY)||'';}
async function api(path){
  const headers={}; if(token())headers.authorization=`Bearer ${token()}`;
  const r=await fetch(path,{credentials:'same-origin',headers});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);
  return data;
}
function connectionState(connectors,platform,type){return connectors.some(c=>c.platform===platform&&c.connector_type===type&&Number(c.enabled)===1);}
function makeWrap(id,label,connected){
  const wrap=document.createElement('div'); wrap.id=`${id}Wrap`; wrap.style.marginBottom='16px';
  wrap.innerHTML=connected
    ? `<button id="${id}" class="btn" disabled>${label} connected</button>`
    : `<button id="${id}" class="btn primary">Connect ${label}</button><p id="${id}Result" class="notice"></p>`;
  return wrap;
}
async function start(platform,id){
  const btn=document.querySelector(`#${id}`), out=document.querySelector(`#${id}Result`); if(!btn)return;
  btn.disabled=true; if(out)out.textContent=`Opening ${platform} authorization…`;
  try{const r=await api(`/api/connectors/${platform}/oauth/start`); if(!r.url)throw new Error('Authorization URL was not returned'); location.assign(r.url);}
  catch(e){if(out)out.textContent=e.message;btn.disabled=false;}
}
async function inject(){
  const main=document.querySelector('#main'); if(!main||document.querySelector('#connectPinterest'))return;
  const heading=[...main.querySelectorAll('h2')].find(h=>h.textContent.trim()==='Publishing connections'); if(!heading)return;
  let connectors=[];try{connectors=await api('/api/connectors');}catch{return;}
  const pinterest=makeWrap('connectPinterest','Pinterest',connectionState(connectors,'pinterest','pinterest'));
  const tiktok=makeWrap('connectTikTok','TikTok',connectionState(connectors,'tiktok','tiktok'));
  const ig=document.querySelector('#connectInstagram');
  const anchor=ig?.parentElement||heading;
  anchor.insertAdjacentElement('afterend',pinterest);
  pinterest.insertAdjacentElement('afterend',tiktok);
  if(!pinterest.querySelector('#connectPinterest')?.disabled)pinterest.querySelector('#connectPinterest').onclick=()=>start('pinterest','connectPinterest');
  if(!tiktok.querySelector('#connectTikTok')?.disabled)tiktok.querySelector('#connectTikTok').onclick=()=>start('tiktok','connectTikTok');
}
const observer=new MutationObserver(()=>inject());
observer.observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('load',inject);setTimeout(inject,800);
