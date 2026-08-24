import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan, adaptPostingPolicy } from '../src/lib/campaign-engine.js';

const products=[
  {id:'p1',name:'One',status:'active',manual_priority:1,sales_url:'https://example.com/1'},
  {id:'p2',name:'Two',status:'active',manual_priority:1,sales_url:'https://example.com/2'}
];
const assets=[
  {id:'a1',product_id:'p1',status:'approved',use_count:0,last_used_at:null,platforms_json:[]},
  {id:'a2',product_id:'p2',status:'approved',use_count:0,last_used_at:null,platforms_json:[]}
];
const copy=[
  {id:'c1',product_id:'p1',status:'approved',text:'Buy One',use_count:0,last_used_at:null},
  {id:'c2',product_id:'p2',status:'approved',text:'Buy Two',use_count:0,last_used_at:null}
];

test('plan creates requested frequency and alternates products where possible',()=>{
  const plan=generatePlan({products,assets,copyItems:copy,postingPolicy:{facebook:{per_day:2,times:['09:00','18:00']}},startISO:'2026-08-24T00:00:00.000Z',origin:'https://app.example.com'});
  assert.equal(plan.length,14);
  for(let i=1;i<plan.length;i++) assert.notEqual(plan[i].product.id,plan[i-1].product.id);
  assert.ok(plan[0].trackingUrl.includes('/r/'));
});

test('default multi-platform cadence creates the expected weekly workload',()=>{
  const postingPolicy={
    facebook:{per_day:2,times:['09:15','18:45']},
    instagram:{per_day:1,times:['12:15']},
    tiktok:{per_day:1,times:['19:30']},
    pinterest:{per_day:5,times:['07:30','10:30','13:30','17:00','20:30']},
    email:{per_week:1,times:['10:00']}
  };
  const plan=generatePlan({products,assets,copyItems:copy,postingPolicy,startISO:'2026-08-24T00:00:00.000Z',origin:'https://app.example.com',timeZone:'America/Chicago'});
  assert.equal(plan.length,64);
  const counts=plan.reduce((acc,item)=>{acc[item.platform]=(acc[item.platform]||0)+1;return acc;},{});
  assert.deepEqual(counts,{facebook:14,instagram:7,tiktok:7,pinterest:35,email:1});
  assert.equal(new Set(plan.map(x=>x.trackingCode)).size,64);
});

test('performance policy can rise or fall within bounds',()=>{
  const base={facebook:{per_day:2,times:['09:00','18:00']},instagram:{per_day:1,times:['12:00']}};
  const next=adaptPostingPolicy(base,{facebook:{impressions:1000,clicks:40,conversions:3},instagram:{impressions:1000,clicks:1,conversions:0}},{minimum_impressions:300});
  assert.equal(next.facebook.per_day,3);
  assert.equal(next.instagram.per_day,1);
});

test('sale evidence outranks weak engagement when adapting posting frequency',()=>{
  const base={instagram:{per_day:1,times:['12:00']},pinterest:{per_day:3,times:['09:00','13:00','18:00']}};
  const next=adaptPostingPolicy(base,{
    instagram:{impressions:50,clicks:0,conversions:1,revenue_cents:499},
    pinterest:{impressions:1000,clicks:1,conversions:0,revenue_cents:0}
  },{minimum_impressions:300});
  assert.equal(next.instagram.per_day,2);
  assert.equal(next.pinterest.per_day,2);
});

test('timezone conversion schedules Chicago noon as UTC afternoon',()=>{
  const plan=generatePlan({products:[products[0]],assets:[assets[0]],copyItems:[copy[0]],postingPolicy:{facebook:{per_day:1,times:['12:00']}},startISO:'2026-08-24T00:00:00.000Z',origin:'https://app.example.com',timeZone:'America/Chicago'});
  assert.equal(plan[0].scheduled_for,'2026-08-24T17:00:00.000Z');
});

test('revenue evidence can increase product score',async()=>{
  const { productScore } = await import('../src/lib/campaign-engine.js');
  const weak=productScore(products[0],{p1:{impressions:1000,clicks:5,conversions:0,revenue_cents:0}});
  const strong=productScore(products[0],{p1:{impressions:1000,clicks:50,conversions:5,revenue_cents:10000}});
  assert.ok(strong>weak);
});

test('creative performance evidence can boost a proven asset',async()=>{
  const { assetScore } = await import('../src/lib/campaign-engine.js');
  const a={id:'creative-a',status:'approved',use_count:4,last_used_at:'2026-07-01T00:00:00.000Z'};
  const baseline=assetScore(a,0.12,{});
  const proven=assetScore(a,0.12,{'creative-a':{impressions:2000,clicks:100,conversions:8,revenue_cents:20000}});
  assert.ok(proven>baseline);
});
