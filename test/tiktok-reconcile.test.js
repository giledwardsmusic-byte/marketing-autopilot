import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyTikTokOutcome, shouldEscalateTikTokPending } from '../src/lib/tiktok-reconcile.js';

test('classifies TikTok final success only after PUBLISH_COMPLETE',()=>{
  assert.deepEqual(classifyTikTokOutcome({status:'PUBLISH_COMPLETE'}),{state:'published',reason:null});
  assert.deepEqual(classifyTikTokOutcome({status:'PROCESSING_DOWNLOAD'}),{state:'pending',reason:null});
  assert.deepEqual(classifyTikTokOutcome({status:'PROCESSING_UPLOAD'}),{state:'pending',reason:null});
});

test('classifies TikTok FAILED with the platform reason',()=>{
  assert.deepEqual(classifyTikTokOutcome({status:'FAILED',fail_reason:'photo_pull_failed'}),{state:'failed',reason:'photo_pull_failed'});
});

test('escalates TikTok submissions that remain pending for six hours',()=>{
  const now=Date.parse('2026-08-26T04:00:00.000Z');
  assert.equal(shouldEscalateTikTokPending('2026-08-25T21:59:59.000Z',now),true);
  assert.equal(shouldEscalateTikTokPending('2026-08-25T22:00:01.000Z',now),false);
  assert.equal(shouldEscalateTikTokPending(null,now),false);
});

test('scheduled runtime reconciles TikTok submissions after publishing runs',()=>{
  const source=fs.readFileSync(new URL('../src/entry.js',import.meta.url),'utf8');
  assert.match(source,/import \{ reconcileTikTokSubmissions \} from '\.\/lib\/tiktok-reconcile\.js'/);
  assert.match(source,/await base\.scheduled\(controller,env,ctx\);[\s\S]*await reconcileTikTokSubmissions\(env\);/);
});
