import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DRIVE_FOLDER_ID, buildArchive, driveSyncConfigured, listFolderFiles, parseCopyBank } from '../src/lib/google-drive-sync.js';

test('uses the designated Marketing Autopilot Drive folder',()=>{
  assert.equal(DEFAULT_DRIVE_FOLDER_ID,'13V50CtAtjWRZ0H_F9kBbjDdWBdsjxxDE');
});

test('Drive sync remains safely disabled until all OAuth secrets exist',()=>{
  assert.equal(driveSyncConfigured({}),false);
  assert.equal(driveSyncConfigured({GOOGLE_DRIVE_CLIENT_ID:'a',GOOGLE_DRIVE_CLIENT_SECRET:'b'}),false);
  assert.equal(driveSyncConfigured({GOOGLE_DRIVE_CLIENT_ID:'a',GOOGLE_DRIVE_CLIENT_SECRET:'b',GOOGLE_DRIVE_REFRESH_TOKEN:'c'}),true);
});

test('Marketing Copy Bank parser imports numbered copy and ignores inventory/status tail',()=>{
  const sample=`MARKETING COPY BANK - TABLE ROCK PRESS\n\nPurpose\nReusable copy.\n\n1. Courage\nBuddy once thought courage meant never being afraid.\n\nThen he learned to move forward.\n\n2. Quiet places\nThe forest changed him because he listened.\n#WhisperingForest\n\nAsset inventory now visible in Drive\nTable Rock Press logo\nStatus\nDrive read access: verified\n`;
  assert.deepEqual(parseCopyBank(sample),[
    {number:1,title:'Courage',text:'Buddy once thought courage meant never being afraid.\n\nThen he learned to move forward.'},
    {number:2,title:'Quiet places',text:'The forest changed him because he listened.\n#WhisperingForest'}
  ]);
});

test('Drive source discovery traverses nested folders and follows pagination',async()=>{
  const originalFetch=globalThis.fetch;
  const seen=[];
  globalThis.fetch=async(url)=>{
    const s=String(url); seen.push(s);
    if(s.includes('oauth2.googleapis.com/token'))return new Response(JSON.stringify({access_token:'token'}),{status:200,headers:{'content-type':'application/json'}});
    if(s.includes(`%27${DEFAULT_DRIVE_FOLDER_ID}%27`)&&!s.includes('pageToken='))return new Response(JSON.stringify({
      nextPageToken:'next-root',
      files:[{id:'copy-bank-folder',name:'Marketing Copy Bank',mimeType:'application/vnd.google-apps.folder'}]
    }),{status:200,headers:{'content-type':'application/json'}});
    if(s.includes(`%27${DEFAULT_DRIVE_FOLDER_ID}%27`)&&s.includes('pageToken=next-root'))return new Response(JSON.stringify({files:[{id:'root-file',name:'root.pdf',mimeType:'application/pdf'}]}),{status:200,headers:{'content-type':'application/json'}});
    if(s.includes('%27copy-bank-folder%27'))return new Response(JSON.stringify({files:[{
      id:'copy-bank-doc',name:'Marketing Copy Bank - Table Rock Press',mimeType:'application/vnd.google-apps.document'
    }]}),{status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({error:{message:`unexpected ${s}`}}),{status:500,headers:{'content-type':'application/json'}});
  };
  try{
    const files=await listFolderFiles({GOOGLE_DRIVE_CLIENT_ID:'a',GOOGLE_DRIVE_CLIENT_SECRET:'b',GOOGLE_DRIVE_REFRESH_TOKEN:'c'});
    assert.equal(files.some(f=>f.id==='copy-bank-doc'),true);
    assert.equal(files.some(f=>f.id==='root-file'),true);
    assert.equal(seen.some(s=>s.includes('pageToken=next-root')),true);
  }finally{globalThis.fetch=originalFetch;}
});

test('Drive archive preserves recovery and notification state without connector secrets',async()=>{
  const rows={
    products:[{id:'p1'}],assets:[{id:'a1'}],copy_items:[{id:'c1'}],campaigns:[{id:'camp1'}],scheduled_posts:[{id:'post1'}],sales_events:[{id:'sale1'}],
    health_events:[{id:'health1',component:'media:instagram',severity:'red',resolved:0}],
    connectors:[{id:'ig1',name:'Instagram Direct',connector_type:'direct',platform:'instagram',enabled:1,priority:10,cost_cents_per_post:0,last_success_at:null,last_error_at:null,last_error:null,created_at:'2026-08-26',updated_at:'2026-08-26'}],
    audit_events:[{id:'audit1',event_type:'post.failed'}],
    settings:[{key:'notification:health:health1',value_json:'{"state":"sent"}',updated_at:'2026-08-26'}]
  };
  const queries=[];
  const env={DB:{prepare(sql){
    queries.push(sql);
    let key='';
    for(const candidate of Object.keys(rows))if(sql.includes(`FROM ${candidate}`)){key=candidate;break;}
    return {all:async()=>({results:rows[key]||[]})};
  }}};
  const archive=await buildArchive(env);
  assert.equal(archive.schema,'marketing-autopilot-drive-archive-v2');
  assert.equal(archive.health_events[0].id,'health1');
  assert.equal(archive.audit_events[0].id,'audit1');
  assert.equal(archive.settings[0].key,'notification:health:health1');
  assert.equal(archive.connectors[0].platform,'instagram');
  assert.equal('secret_ciphertext' in archive.connectors[0],false);
  assert.equal('secret_iv' in archive.connectors[0],false);
  const connectorQuery=queries.find(q=>q.includes('FROM connectors'))||'';
  assert.equal(connectorQuery.includes('secret_ciphertext'),false);
  assert.equal(connectorQuery.includes('secret_iv'),false);
});
