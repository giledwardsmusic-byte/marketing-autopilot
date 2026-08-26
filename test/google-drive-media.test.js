import test from 'node:test';
import assert from 'node:assert/strict';
import { driveMediaCandidate, productForDriveCreative, driveCreativeStatus } from '../src/lib/google-drive-sync.js';

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

test('Supported creatives in the designated Drive source are visible immediately after sync',()=>{
  assert.equal(productForDriveCreative({name:'Buddy ad 1.png'}),'prd_table_rock_buddy');
  assert.equal(driveCreativeStatus({name:'Buddy ad 1.png',mimeType:'image/png',size:'2500000'}),'approved');
  assert.equal(productForDriveCreative({name:'Finn cover.jpg'}),null);
  assert.equal(driveCreativeStatus({name:'Finn cover.jpg',mimeType:'image/jpeg',size:'1200000'}),'approved');
  assert.equal(productForDriveCreative({name:'Oliver Owl ad.png'}),null);
  assert.equal(driveCreativeStatus({name:'Oliver Owl ad.png',mimeType:'image/png',size:'1200000'}),'approved');
  assert.equal(productForDriveCreative({name:'Sage Nut cover.webp'}),null);
  assert.equal(driveCreativeStatus({name:'Sage Nut cover.webp',mimeType:'image/webp',size:'1200000'}),'approved');
  assert.equal(driveCreativeStatus({name:'Table Rock Press Logo.jpg',mimeType:'image/jpeg',size:'300000'}),'paused');
});