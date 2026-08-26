import test from 'node:test';
import assert from 'node:assert/strict';
import { sendAlertOnce } from '../src/lib/notifications.js';

function dbWithOneSentWriteFailure(){
  const store=new Map();
  let failSentWrite=true;
  return {
    store,
    prepare(sql){
      return {
        _args:[],
        bind(...args){this._args=args;return this;},
        async run(){
          const key=this._args[0];
          if(sql.startsWith('DELETE FROM settings')){
            const cur=store.get(key);
            if(cur&&JSON.parse(cur.value_json).state==='pending'){
              store.delete(key);
              return {meta:{changes:1}};
            }
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
          if(failSentWrite&&key==='notification:health:h-provider-accepted'){
            failSentWrite=false;
            throw new Error('simulated D1 sent-state write failure');
          }
          store.set(key,{value_json:this._args[1],updated_at:this._args[2]});
          return {meta:{changes:1}};
        }
      };
    }
  };
}

test('retry reuses the same Resend idempotency key after provider acceptance but local sent-state failure',async()=>{
  const DB=dbWithOneSentWriteFailure();
  const oldFetch=globalThis.fetch;
  const providerKeys=[];
  const providerDeliveries=new Set();
  globalThis.fetch=async(_url,init)=>{
    const key=init.headers['idempotency-key'];
    providerKeys.push(key);
    providerDeliveries.add(key);
    return new Response(JSON.stringify({id:'em_provider_once'}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const env={DB,RESEND_API_KEY:'x',ALERT_EMAIL_TO:'a@example.com',ALERT_EMAIL_FROM:'b@example.com'};
    const alert={key:'health:h-provider-accepted',subject:'Needs Attention',text:'blocked post'};
    await assert.rejects(()=>sendAlertOnce(env,alert),/simulated D1 sent-state write failure/);
    assert.equal(DB.store.has('notification:health:h-provider-accepted'),false);
    assert.equal((await sendAlertOnce(env,alert)).state,'sent');
    assert.deepEqual(providerKeys,[
      'marketing-autopilot:health:h-provider-accepted',
      'marketing-autopilot:health:h-provider-accepted'
    ]);
    assert.equal(providerDeliveries.size,1);
  }finally{
    globalThis.fetch=oldFetch;
  }
});
