const TOKEN_KEY='ma_session_token';
const PAGE_ID='1129450230257220';
const PAGE_NAME='Table Rock Press';

function sessionToken(){ return localStorage.getItem(TOKEN_KEY)||''; }

async function api(path,opts={}){
  const headers={...(opts.headers||{})};
  if(!(opts.body instanceof FormData)) headers['content-type']='application/json';
  if(sessionToken()) headers.authorization=`Bearer ${sessionToken()}`;
  const init={...opts,credentials:'same-origin',headers};
  if(init.body && !(init.body instanceof FormData) && typeof init.body!=='string') init.body=JSON.stringify(init.body);
  const r=await fetch(path,init);
  let data={}; try{data=await r.json()}catch{}
  if(!r.ok) throw new Error(data.error||`Request failed (${r.status})`);
  return data;
}

function showToast(msg){
  const t=document.querySelector('#toast');
  if(!t)return;
  t.textContent=msg;
  t.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>t.classList.add('hidden'),3200);
}

function openFacebookModal(){
  const modal=document.querySelector('#modal');
  const body=document.querySelector('#modalBody');
  if(!modal||!body)return;
  body.innerHTML=`
    <div class="row between"><h2 style="margin:0">Connect Facebook</h2><button id="fbClose" class="btn ghost">Close</button></div>
    <p class="muted small">Connect Marketing Autopilot to your Table Rock Press Facebook Page.</p>
    <label>Facebook Page</label>
    <input value="${PAGE_NAME}" readonly>
    <label>Page ID</label>
    <input value="${PAGE_ID}" readonly>
    <label>Page access token</label>
    <input id="fbToken" type="password" autocomplete="off" placeholder="Paste the token you copied" required>
    <p class="muted small">The token is encrypted before storage and is never shown again.</p>
    <button id="fbConnect" class="btn primary wide">Connect Table Rock Press</button>
    <p id="fbResult" class="notice"></p>`;
  modal.showModal();
  document.querySelector('#fbClose').onclick=()=>modal.close();
  document.querySelector('#fbConnect').onclick=async()=>{
    const token=document.querySelector('#fbToken').value.trim();
    const result=document.querySelector('#fbResult');
    if(!token){result.textContent='Paste the Facebook Page access token first.';return;}
    const btn=document.querySelector('#fbConnect');
    btn.disabled=true; result.textContent='Connecting…';
    try{
      await api('/api/connectors',{method:'POST',body:{
        platform:'facebook',
        connector_type:'meta_facebook',
        name:'Table Rock Press Facebook',
        secret:token,
        config:{page_id:PAGE_ID},
        priority:10,
        cost_cents_per_post:0,
        enabled:true
      }});
      document.querySelector('#fbToken').value='';
      result.textContent='Facebook connected.';
      showToast('Table Rock Press connected to Facebook');
      setTimeout(()=>{modal.close();document.querySelector('[data-tab="settings"]')?.click();},500);
    }catch(e){
      result.textContent=e.message;
      btn.disabled=false;
    }
  };
}

async function injectButton(){
  const main=document.querySelector('#main');
  if(!main||document.querySelector('#connectFacebook'))return;
  const heading=[...main.querySelectorAll('h2')].find(h=>h.textContent.trim()==='Publishing connections');
  if(!heading)return;
  const card=heading.closest('.card');
  if(!card)return;
  let connected=false;
  try{
    const connectors=await api('/api/connectors');
    connected=(connectors||[]).some(c=>c.platform==='facebook'&&c.connector_type==='meta_facebook'&&Number(c.enabled)===1);
  }catch{}
  const wrap=document.createElement('div');
  wrap.style.marginBottom='16px';
  wrap.innerHTML=connected
    ? '<button id="connectFacebook" class="btn" disabled>Facebook connected</button>'
    : '<button id="connectFacebook" class="btn primary">Connect Facebook</button>';
  heading.insertAdjacentElement('afterend',wrap);
  if(!connected) document.querySelector('#connectFacebook').onclick=openFacebookModal;
}

const observer=new MutationObserver(()=>injectButton());
observer.observe(document.documentElement,{subtree:true,childList:true});
window.addEventListener('load',injectButton);
setTimeout(injectButton,500);
