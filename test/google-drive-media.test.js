import test from 'node:test';
import assert from 'node:assert/strict';
import { driveMediaCandidate, productForDriveCreative, driveCreativeStatus } from '../src/lib/google-drive-sync.js';

const products=[
  {id:'prd_table_rock_buddy',name:'Buddy and the Whispering Forest'},
  {id:'prd_sage_nut',name:'Sage Nut'},
  {id:'prd_retiring',name:'Retiring Without Going Broke'}
];

test('Drive media ingestion accepts supported image files before product classification',()=>{
  assert.equal(driveMediaCandidate({name:'Buddy ad 1.png',mimeType:'image/png',size:'2500000'}),true);
  assert.equal(driveMediaCandidate({name:'Retiring_Without_Going_Broke_ad_02.jpg',mimeType:'image/jpeg',size:'1200000'}),true);
  assert.equal(driveMediaCandidate({name:'portrait.webp',mimeType:'image/webp',size:'900000'}),true);
});

test('Drive media ingestion excludes logos, unsupported types, empty files, and oversized sources',()=>{
  assert.equal(driveMediaCandidate({name:'Table Rock Press Logo.jpg',mimeType:'image/jpeg',size:'300000'}),false);
  assert.equal(driveMediaCandidate({name:'video.mp4',mimeType:'video/mp4',size:'2000000'}),false);
  assert.equal(driveMediaCandidate({name:'empty.png',mimeType:'image/png',size:'0'}),false);
  assert.equal(driveMediaCandidate({name:'huge.png',mimeType:'image/png',size:String(26*1024*1024)}),false);
});

test('Drive creatives match recognized products across fiction and nonfiction',()=>{
  assert.equal(productForDriveCreative({name:'Buddy ad 1.png'},products),'prd_table_rock_buddy');
  assert.equal(productForDriveCreative({name:'Sage Nut cover.webp'},products),'prd_sage_nut');
  assert.equal(productForDriveCreative({name:'Retiring_Without_Going_Broke_ad_02.jpg'},products),'prd_retiring');
});

test('Unrecognized creatives are held out of rotation rather than guessed',()=>{
  const file={name:'Pill ad 1.jpg',mimeType:'image/jpeg',size:'1200000'};
  const productId=productForDriveCreative(file,products);
  assert.equal(productId,null);
  assert.equal(driveCreativeStatus(file,productId),'paused');
});

test('Recognized creatives become approved while logos stay paused',()=>{
  const buddy={name:'Buddy ad 1.png',mimeType:'image/png',size:'2500000'};
  const buddyProduct=productForDriveCreative(buddy,products);
  assert.equal(driveCreativeStatus(buddy,buddyProduct),'approved');
  assert.equal(driveCreativeStatus({name:'Table Rock Press Logo.jpg',mimeType:'image/jpeg',size:'300000'},null),'paused');
});