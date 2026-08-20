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

test('performance policy can rise or fall within bounds',()=>{
  const base={facebook:{per_day:2,times:['09:00','18:00']},instagram:{per_day:1,times:['12:00']}};
  const next=adaptPostingPolicy(base,{facebook:{impressions:1000,clicks:40,conversions:3},instagram:{impressions:1000,clicks:1,conversions:0}},{minimum_impressions:300});
  assert.equal(next.facebook.per_day,3);
  assert.equal(next.instagram.per_day,1);
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
