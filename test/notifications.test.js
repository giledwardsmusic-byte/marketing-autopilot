import test from 'node:test';
import assert from 'node:assert/strict';
import { alertEmailConfigured, sendAlertOnce, notifyRecordedPaidSales, notifyUnresolvedHealth } from '../src/lib/notifications.js';

function dbMock(){
  const store=new Map();
  return {
    store,
    prepare(sql){
      return {
        _args:[],
        bind(...args){this._args=args;return this;},
        async first(){return store.has(this._args[0])?{value_json:store.get(this._args[0]).value_json}:null;},
        async run(){
          const key=this._args[0];
          if(sql.startsWith('DELETE FROM settings')){
            const cur=store.get(key);
            if(cur&&JSON.parse(cur.value_json).state==='pending'){store.delete(key);return {meta:{changes:1}};}
            return {meta:{changes:0}};
          }
          if(sql.includes("json_extract(settings.value_json,'$.state')='pending'")){
            const [,value,updatedAt,staleBefore]=this._args;
            const cur=store.get(key);
            if(!cur){store.set(key,{value_json:value,updated_at:updatedAt});return {meta:{changes:1}};}
            const state=JSON.parse(cur.value_json).state;
            if(state==='pending'&&cur.updated_at<=staleBefore){store.set(key,{value_json:value,updated_at:updatedAt});return {meta:{changes:1}};}
            return {meta:{changes:0}};
          }
          store.set(key,{value_json:this._args[1],updated_at:this._args[2]});
          return {meta:{changes:1}};
        }
      };
    }
  };
}

test('email alerts remain disabled until free provider credentials are configured',()=>{
  assert.equal(alertEmailConfigured({}),false);
  assert.equal(alertEmailConfigured({RESEND_API_KEY:'x',ALERT_EMAIL_TO:'a@example.com',ALERT_EMAIL_FROM:'b@example.com'}),true);
});

test('required alert delivery fails closed when email is unconfigured',async()=>{
  await assert.rejects(()=>sendAlertOnce({},{key:'required',subject:'s',text:'t'}),/Email alerts are not configured/);
});

test('successful notification is deduplicated',async()=>{
  const DB=dbMock();
  const oldFetch=globalThis.fetch; let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({id:'em_1'}),{status:200,headers:{'content-type':'application/json'}});};
  try{
    const env={DB,RESEND_API_KEY:'x',ALERT_EMAIL_TO:'a@example.com',ALERT_EMAIL_FROM:'b@example.com'};
    assert.equal((await sendAlertOnce(env,{key:'k1',subject:'s',text:'t'})).state,'sent');
    assert.equal((await sendAlertOnce(env,{key:'k1',subject:'s',text:'t'})).state,'duplicate');
    assert.equal(calls,1);
  }finally{globalThis.fetch=oldFetch;}
});

test('concurrent notification attempts produce only one provider send',async()=>{
  const DB=dbMock();
  const oldFetch=globalThis.fetch; let calls=0; let release;
  const gate=new Promise(resolve=>{release=resolve;});
  globalThis.fetch=async()=>{calls++;await gate;return new Response(JSON.stringify({id:'em_concurrent'}),{status:200,headers:{'content-type':'application/json'}});};
  try{
    const env={DB,RESEND_API_KEY:'x',ALERT_EMAIL_TO:'a@example.com',ALERT_EMAIL_FROM:'b@example.com'};
    const first=sendAlertOnce(env,{key:'same',subject:'s',text:'t'});
    await new Promise(resolve=>setTimeout(resolve,0));
    const second=await sendAlertOnce(env,{key:'same',subject:'s',text:'t'});
    assert.equal(second.state,'duplicate');
    release();
    assert.equal((await first).state,'sent');
    assert.equal(calls,1);
  }finally{globalThis.fetch=oldFetch;}
});

test('failed delivery releases claim so it can retry',async()=>{
  const DB=dbMock();
  const oldFetch=globalThis.fetch; let calls=0;
  globalThis.fetch=async()=>{
    calls++;
    if(calls===1)return new Response(JSON.stringify({message:'temporary'}),{status:503,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({id:'em_retry'}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const env={DB,RESEND_API_KEY:'x',ALERT_EMAIL_TO:'a@example.com',ALERT_EMAIL_FROM:'b@example.com'};
    await assert.rejects(()=>sendAlertOnce(env,{key:'retry',subject:'s',text:'t'}),/Resend 503/);
    assert.equal(DB.store.has('notification:retry'),false);
    assert.equal((await sendAlertOnce(env,{key:'retry',subject:'s',text:'t'})).state,'sent');
    assert.equal(calls,2);
  }finally{globalThis.fetch=oldFetch;}
});

test('recorded Payhip sale alert retries after provider failure and then deduplicates',async()=>{
  const DB=dbMock();
  const originalPrepare=DB.prepare.bind(DB);
  const saleRows=[{transaction_id:'TX123',amount_cents:499,currency:'USD',occurred_at:'2026-08-24T09:00:00.000Z',product_names:'Sage Nut'}];
  DB.prepare=(sql)=>{
    if(sql.includes("FROM sales_events se"))return {async all(){return {results:saleRows};}};
    return originalPrepare(sql);
  };
  const oldFetch=globalThis.fetch; let calls=0;
  globalThis.fetch=async()=>{
    calls++;
    if(calls===1)return new Response(JSON.stringify({message:'temporary'}),{status:503,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({id:'em_sale'}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const env={DB,RESEND_API_KEY:'x',ALERT_EMAIL_TO:'a@example.com',ALERT_EMAIL_FROM:'b@example.com'};
    const first=await notifyRecordedPaidSales(env);
    assert.equal(first[0].state,'failed');
    assert.equal(DB.store.has('notification:sale:payhip:TX123'),false);
    const second=await notifyRecordedPaidSales(env);
    assert.equal(second[0].state,'sent');
    const third=await notifyRecordedPaidSales(env);
    assert.equal(third[0].state,'duplicate');
    assert.equal(calls,2);
  }finally{globalThis.fetch=oldFetch;}
});

test('health sweep covers every unresolved event, including more than 50',async()=>{
  const rows=Array.from({length:75},(_,i)=>({id:`h${i+1}`,component:`component:${i+1}`,severity:i%3===0?'red':'yellow',message:`issue ${i+1}`,created_at:`2026-08-23T00:${String(i%60).padStart(2,'0')}:00.000Z`}));
  const DB=dbMock();
  const originalPrepare=DB.prepare.bind(DB);
  DB.prepare=(sql)=>{
    if(sql.includes('FROM health_events WHERE resolved=0'))return {async all(){return {results:rows};}};
    return originalPrepare(sql);
  };
  const oldFetch=globalThis.fetch; let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({id:`em_${calls}`}),{status:200,headers:{'content-type':'application/json'}});};
  try{
    const env={DB,RESEND_API_KEY:'x',ALERT_EMAIL_TO:'a@example.com',ALERT_EMAIL_FROM:'b@example.com'};
    const out=await notifyUnresolvedHealth(env);
    assert.equal(out.length,75);
    assert.equal(calls,75);
    assert.ok(out.every(x=>x.state==='sent'));
  }finally{globalThis.fetch=oldFetch;}
});

test('health sweep fails closed when any required email delivery fails',async()=>{
  const rows=[{id:'h1',component:'publish:instagram',severity:'red',message:'blocked',created_at:'2026-08-25T00:00:00.000Z'}];
  const DB=dbMock();
  const originalPrepare=DB.prepare.bind(DB);
  DB.prepare=(sql)=>{
    if(sql.includes('FROM health_events WHERE resolved=0'))return {async all(){return {results:rows};}};
    return originalPrepare(sql);
  };
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({message:'temporary'}),{status:503,headers:{'content-type':'application/json'}});
  try{
    const env={DB,RESEND_API_KEY:'x',ALERT_EMAIL_TO:'a@example.com',ALERT_EMAIL_FROM:'b@example.com'};
    await assert.rejects(()=>notifyUnresolvedHealth(env),/1 health alert\(s\) failed and will retry/);
    assert.equal(DB.store.has('notification:health:h1'),false);
  }finally{globalThis.fetch=oldFetch;}
});
