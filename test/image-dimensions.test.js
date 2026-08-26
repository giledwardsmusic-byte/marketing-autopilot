import test from 'node:test';
import assert from 'node:assert/strict';
import { imageDimensions } from '../src/lib/image-dimensions.js';

test('reads PNG dimensions from IHDR',()=>{
  const a=new Uint8Array(24);
  a.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a],0);
  a.set([0x00,0x00,0x04,0x38],16); // 1080
  a.set([0x00,0x00,0x05,0x46],20); // 1350
  assert.deepEqual(imageDimensions(a,'image/png'),{width:1080,height:1350});
});

test('reads JPEG SOF dimensions',()=>{
  const a=Uint8Array.from([
    0xff,0xd8,
    0xff,0xe0,0x00,0x04,0x00,0x00,
    0xff,0xc0,0x00,0x11,0x08,0x05,0xdc,0x03,0xe8,0x03,0x01,0x11,0x00,0x02,0x11,0x00,0x03,0x11,0x00,
    0xff,0xd9
  ]);
  assert.deepEqual(imageDimensions(a,'image/jpeg'),{width:1000,height:1500});
});

test('reads WebP VP8X dimensions',()=>{
  const a=new Uint8Array(30);
  a.set([...Buffer.from('RIFF')],0);
  a.set([...Buffer.from('WEBP')],8);
  a.set([...Buffer.from('VP8X')],12);
  const w=1199,h=1499;
  a[24]=w&255;a[25]=(w>>8)&255;a[26]=(w>>16)&255;
  a[27]=h&255;a[28]=(h>>8)&255;a[29]=(h>>16)&255;
  assert.deepEqual(imageDimensions(a,'image/webp'),{width:1200,height:1500});
});

test('returns null for malformed input',()=>{
  assert.equal(imageDimensions(new Uint8Array([1,2,3]),'image/jpeg'),null);
});
