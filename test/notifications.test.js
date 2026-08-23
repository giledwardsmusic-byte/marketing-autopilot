import test from 'node:test';
import assert from 'node:assert/strict';
import { alertEmailConfigured, sendAlertOnce } from '../src/lib/notifications.js';

function dbMock(){
  const store=new Map();
  return {
    store,
    prepare(sql){
      return {
        _args:[],
        bind(...args){this._args=args;return this;},
        async first(){return store.has(this._args[0])?{value_json:store.get(this._args[0])}:null;},
        async run(){store.set(this._args[0],this._args[1]);return {meta:{changes:1}};}
      };
    }
  };
}

test('email alerts remain disabled until free provider credentials are configured',()=>{
  assert.equal(alertEmailConfigured({}),false);
  assert.equal(alertEmailConfigured({RESEND_API_KEY:'x',ALERT_EMAIL_TO:'a@example.com',ALERT_EMAIL_FROM:'b@example.com'}),true);
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

test('failed delivery is not marked sent so it can retry',async()=>{
  const DB=dbMock();
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({message:'temporary'}),{status:503,headers:{'content-type':'application/json'}});
  try{
    const env={DB,RESEND_API_KEY:'x',ALERT_EMAIL_TO:'a@example.com',ALERT_EMAIL_FROM:'b@example.com'};
    await assert.rejects(()=>sendAlertOnce(env,{key:'retry',subject:'s',text:'t'}),/Resend 503/);
    assert.equal(DB.store.has('notification:retry'),false);
  }finally{globalThis.fetch=oldFetch;}
});
