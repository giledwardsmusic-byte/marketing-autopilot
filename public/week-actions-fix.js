const TOKEN_KEY='ma_session_token';
const token=()=>localStorage.getItem(TOKEN_KEY)||'';

async function api(path,opts={}){
  const headers={...(opts.body instanceof FormData?{}:{'content-type':'application/json'}),...(opts.headers||{})};
  if(token())headers.authorization=`Bearer ${token()}`;
  const init={...opts,credentials:'same-origin',headers};
  if(init.body&&!(init.body instanceof FormData)&&typeof init.body!=='string')init.body=JSON.stringify(init.body);
  const r=await fetch(path,init);
  let data={};
  try{data=await r.json()}catch{}
  if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);
  return data;
}

function nextMonday(){
  const d=new Date(),day=d.getUTCDay(),add=((8-day)%7)||7;
  d.setUTCDate(d.getUTCDate()+add);
  d.setUTCHours(0,0,0,0);
  return d.toISOString();
}

function showToast(msg){
  const t=document.querySelector('#toast');
  if(!t)return;
  t.textContent=msg;
  t.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>t.classList.add('hidden'),3200);
}

async function loadPost(id){
  const start=nextMonday();
  const w=await api(`/api/week?start=${encodeURIComponent(start)}`);
  return (w.posts||[]).find(p=>p.id===id)||null;
}

function openEdit(post){
  const modal=document.querySelector('#modal');
  const body=document.querySelector('#modalBody');
  if(!modal||!body)return;
  const scheduled=post.scheduled_for?new Date(post.scheduled_for).toISOString().slice(0,16):'';
  body.innerHTML=`<div class="row between"><h2 style="margin:0">Edit post</h2><button id="hotfixClose" class="btn ghost">Close</button></div><label>Caption</label><textarea id="hotfixCaption"></textarea><label>Scheduled time</label><input id="hotfixTime" type="datetime-local"><button id="hotfixSave" class="btn primary wide">Save changes</button><p id="hotfixResult" class="notice"></p>`;
  document.querySelector('#hotfixCaption').value=post.caption||'';
  document.querySelector('#hotfixTime').value=scheduled;
  document.querySelector('#hotfixClose').onclick=()=>modal.close();
  document.querySelector('#hotfixSave').onclick=async()=>{
    const out=document.querySelector('#hotfixResult');
    try{
      const raw=document.querySelector('#hotfixTime').value;
      if(!raw)throw new Error('Choose a scheduled time.');
      await api(`/api/posts/${post.id}`,{method:'PATCH',body:{caption:document.querySelector('#hotfixCaption').value,scheduled_for:new Date(raw).toISOString()}});
      out.textContent='Saved.';
      showToast('Post updated');
      setTimeout(()=>location.reload(),350);
    }catch(e){out.textContent=e.message||'Save failed';}
  };
  modal.showModal();
}

document.addEventListener('click',async e=>{
  const action=e.target.closest?.('[data-action][data-id]');
  if(action){
    e.preventDefault();
    e.stopImmediatePropagation();
    const status=action.dataset.action;
    const label=action.textContent;
    action.disabled=true;
    if(status==='approved')action.textContent='Approving…';
    try{
      await api(`/api/posts/${action.dataset.id}`,{method:'PATCH',body:{status}});
      showToast(status==='approved'?'Post approved':status==='paused'?'Post paused':'Post rejected');
      setTimeout(()=>location.reload(),350);
    }catch(err){
      action.disabled=false;
      action.textContent=label;
      showToast(err.message||'Post update failed');
    }
    return;
  }

  const edit=e.target.closest?.('[data-edit]');
  if(edit){
    e.preventDefault();
    e.stopImmediatePropagation();
    try{
      const post=await loadPost(edit.dataset.edit);
      if(!post)throw new Error('Could not find that post.');
      openEdit(post);
    }catch(err){showToast(err.message||'Could not open post');}
  }
},true);
