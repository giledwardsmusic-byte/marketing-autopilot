import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverInstagramBusinessAccount } from '../src/lib/instagram-connect.js';

test('discovers linked Instagram professional account from Facebook Page',async()=>{
  let seen='';
  const fetchFn=async url=>{
    seen=String(url);
    return new Response(JSON.stringify({instagram_business_account:{id:'17841400000000000',username:'tablerockpress'}}),{status:200,headers:{'content-type':'application/json'}});
  };
  const result=await discoverInstagramBusinessAccount({pageId:'1129450230257220',pageAccessToken:'page-token',fetchFn});
  assert.equal(result.ig_user_id,'17841400000000000');
  assert.equal(result.username,'tablerockpress');
  assert.match(seen,/instagram_business_account/);
  assert.match(seen,/access_token=page-token/);
});

test('fails clearly when Facebook Page has no linked Instagram professional account',async()=>{
  const fetchFn=async()=>new Response(JSON.stringify({id:'1129450230257220'}),{status:200,headers:{'content-type':'application/json'}});
  await assert.rejects(
    discoverInstagramBusinessAccount({pageId:'1129450230257220',pageAccessToken:'page-token',fetchFn}),
    /No Instagram professional account is linked/
  );
});

test('surfaces Meta discovery errors without creating a false connection',async()=>{
  const fetchFn=async()=>new Response(JSON.stringify({error:{message:'Permissions error'}}),{status:403,headers:{'content-type':'application/json'}});
  await assert.rejects(
    discoverInstagramBusinessAccount({pageId:'1129450230257220',pageAccessToken:'page-token',fetchFn}),
    /Permissions error/
  );
});
