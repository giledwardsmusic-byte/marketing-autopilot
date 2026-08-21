import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireSchedulerLease, releaseSchedulerLease } from '../src/entry.js';

function fakeLeaseDb(){
  let row=null;
  return {
    get row(){return row;},
    prepare(sql){
      return {
        bind(...args){
          return {
            async run(){
              if(sql.startsWith('INSERT INTO settings')){
                const [key,valueJson,updatedAt,compareAt]=args;
                assert.equal(key,'scheduler:lease');
                const incoming=JSON.parse(valueJson);
                if(!row || !row.expires_at || row.expires_at<=compareAt){
                  row={...incoming,updated_at:updatedAt};
                  return {meta:{changes:1}};
                }
                return {meta:{changes:0}};
              }
              if(sql.startsWith('DELETE FROM settings')){
                const [key,token]=args;
                assert.equal(key,'scheduler:lease');
                if(row?.token===token){row=null;return {meta:{changes:1}};}
                return {meta:{changes:0}};
              }
              throw new Error(`Unexpected SQL: ${sql}`);
            }
          };
        }
      };
    }
  };
}

test('scheduler lease prevents an overlapping run and releases only its own token',async()=>{
  const DB=fakeLeaseDb();
  const env={DB};
  const now=new Date('2026-08-21T16:00:00.000Z');

  const first=await acquireSchedulerLease(env,now);
  assert.ok(first);
  assert.equal(DB.row.token,first);

  const overlapping=await acquireSchedulerLease(env,new Date('2026-08-21T16:05:00.000Z'));
  assert.equal(overlapping,null);
  assert.equal(DB.row.token,first);

  await releaseSchedulerLease(env,'not-the-owner');
  assert.equal(DB.row.token,first);

  await releaseSchedulerLease(env,first);
  assert.equal(DB.row,null);

  const next=await acquireSchedulerLease(env,new Date('2026-08-21T16:05:01.000Z'));
  assert.ok(next);
  assert.notEqual(next,first);
});

test('expired scheduler lease can be recovered after an interrupted run',async()=>{
  const DB=fakeLeaseDb();
  const env={DB};
  const first=await acquireSchedulerLease(env,new Date('2026-08-21T16:00:00.000Z'));
  assert.ok(first);

  const recovered=await acquireSchedulerLease(env,new Date('2026-08-21T16:10:01.000Z'));
  assert.ok(recovered);
  assert.notEqual(recovered,first);
  assert.equal(DB.row.token,recovered);
});
