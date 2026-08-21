import test from 'node:test';
import assert from 'node:assert/strict';
import { login } from '../src/lib/auth.js';

function envWithUsers(users){
  const sessions=[];
  const audits=[];
  const env={
    BOOTSTRAP_ADMIN_EMAIL:'owner@example.com',
    BOOTSTRAP_ADMIN_PASSWORD:'correct horse battery staple',
    DB:{
      prepare(sql){
        let args=[];
        const stmt={
          bind(...xs){ args=xs; return stmt; },
          async first(){
            if(sql.includes("FROM users WHERE email=? AND role='owner' AND status='active'")){
              const email=String(args[0]||'').toLowerCase();
              return users.find(u=>u.email===email && u.role==='owner' && u.status==='active')||null;
            }
            if(sql.includes("FROM users WHERE email=? AND status='active'")){
              const email=String(args[0]||'').toLowerCase();
              return users.find(u=>u.email===email && u.status==='active')||null;
            }
            if(sql.includes("FROM users WHERE role='owner' AND status='active' ORDER BY created_at")){
              return users.find(u=>u.role==='owner' && u.status==='active')||null;
            }
            return null;
          },
          async run(){
            if(sql.startsWith('INSERT INTO sessions')) sessions.push(args);
            if(sql.startsWith('INSERT INTO audit_events')) audits.push(args);
            return {meta:{changes:1}};
          }
        };
        return stmt;
      }
    }
  };
  return {env,sessions,audits};
}

test('passwordless owner login requires the exact active owner email',async()=>{
  const {env,sessions}=envWithUsers([
    {id:'owner1',email:'owner@example.com',role:'owner',status:'active'},
    {id:'viewer1',email:'viewer@example.com',role:'viewer',status:'active'}
  ]);

  const ok=await login(env,'owner@example.com','');
  assert.equal(ok.user.id,'owner1');
  assert.equal(sessions.length,1);

  const wrong=await login(env,'wrong@example.com','');
  assert.equal(wrong,null);
  assert.equal(sessions.length,1);

  const viewer=await login(env,'viewer@example.com','');
  assert.equal(viewer,null);
  assert.equal(sessions.length,1);
});

test('passwordless owner login rejects blank email',async()=>{
  const {env,sessions}=envWithUsers([
    {id:'owner1',email:'owner@example.com',role:'owner',status:'active'}
  ]);
  const result=await login(env,'','');
  assert.equal(result,null);
  assert.equal(sessions.length,0);
});
