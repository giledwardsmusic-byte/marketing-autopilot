import test from 'node:test';
import assert from 'node:assert/strict';
import { driveMediaCandidate } from '../src/lib/google-drive-sync.js';

test('Drive media ingestion accepts supported real creatives',()=>{
  assert.equal(driveMediaCandidate({name:'Buddy ad 1.png',mimeType:'image/png',size:'2500000'}),true);
  assert.equal(driveMediaCandidate({name:'Finn cover.jpg',mimeType:'image/jpeg',size:'1200000'}),true);
  assert.equal(driveMediaCandidate({name:'portrait.webp',mimeType:'image/webp',size:'900000'}),true);
});

test('Drive media ingestion excludes logos, unsupported types, empty files, and oversized sources',()=>{
  assert.equal(driveMediaCandidate({name:'Table Rock Press Logo.jpg',mimeType:'image/jpeg',size:'300000'}),false);
  assert.equal(driveMediaCandidate({name:'video.mp4',mimeType:'video/mp4',size:'2000000'}),false);
  assert.equal(driveMediaCandidate({name:'empty.png',mimeType:'image/png',size:'0'}),false);
  assert.equal(driveMediaCandidate({name:'huge.png',mimeType:'image/png',size:String(26*1024*1024)}),false);
});
