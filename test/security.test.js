import test from 'node:test';
import assert from 'node:assert/strict';
import { randomSalt, hashPassword, verifyPassword, randomToken } from '../src/lib/security.js';

test('password hashing verifies correct password',async()=>{
  const salt=randomSalt(); const hash=await hashPassword('correct horse battery staple',salt,1000);
  assert.equal(await verifyPassword('correct horse battery staple',salt,hash),false); // verifyPassword uses production iterations; mismatch is expected in this reduced-round test
  const productionHash=await hashPassword('correct horse battery staple',salt);
  assert.equal(await verifyPassword('correct horse battery staple',salt,productionHash),true);
  assert.equal(await verifyPassword('wrong',salt,productionHash),false);
});

test('session tokens are nontrivial and unique',()=>{
  const a=randomToken(),b=randomToken(); assert.notEqual(a,b); assert.ok(a.length>30);
});
