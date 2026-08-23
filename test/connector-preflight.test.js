import test from 'node:test';
import assert from 'node:assert/strict';
import { connectorPreflight } from '../src/lib/connector-preflight.js';

const secret='encrypted-placeholder';
const connector=(connector_type,config_json='{}',extra={})=>({connector_type,config_json,enabled:1,secret_ciphertext:secret,...extra});

test('sandbox is ready without credentials',()=>{
  assert.deepEqual(connectorPreflight({connector_type:'sandbox',config_json:'{}',enabled:1}),{ok:true,errors:[]});
});

test('facebook direct route requires credential and page id',()=>{
  const result=connectorPreflight({connector_type:'meta_facebook',config_json:'{}',enabled:1});
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('Connector credential is not stored'));
  assert.ok(result.errors.includes('Facebook page_id is missing'));
});

test('instagram direct route rejects missing or non-JPEG creative',()=>{
  const noAsset=connectorPreflight(connector('meta_instagram','{"ig_user_id":"123"}'));
  assert.ok(noAsset.errors.includes('Instagram requires an approved graphic'));
  const png=connectorPreflight(connector('meta_instagram','{"ig_user_id":"123"}'),{public_token:'asset-token',mime_type:'image/png'});
  assert.ok(png.errors.includes('Instagram direct publishing requires JPEG creative'));
  const jpeg=connectorPreflight(connector('meta_instagram','{"ig_user_id":"123"}'),{public_token:'asset-token',mime_type:'image/jpeg'});
  assert.equal(jpeg.ok,true);
});

test('pinterest requires board id and an approved graphic',()=>{
  const result=connectorPreflight(connector('pinterest','{}'));
  assert.ok(result.errors.includes('Pinterest board_id is missing'));
  assert.ok(result.errors.includes('Pinterest requires an approved graphic'));
});

test('tiktok requires credential and approved supported media',()=>{
  const empty=connectorPreflight({connector_type:'tiktok',config_json:'{}',enabled:1});
  assert.ok(empty.errors.includes('Connector credential is not stored'));
  assert.ok(empty.errors.includes('TikTok requires approved media'));
  const jpeg=connectorPreflight(connector('tiktok','{}'),{public_token:'asset-token',mime_type:'image/jpeg'});
  assert.equal(jpeg.ok,true);
  const video=connectorPreflight(connector('tiktok','{}'),{public_token:'asset-token',mime_type:'video/mp4'});
  assert.equal(video.ok,true);
  const png=connectorPreflight(connector('tiktok','{}'),{public_token:'asset-token',mime_type:'image/png'});
  assert.ok(png.errors.includes('TikTok direct publishing requires MP4/QuickTime video or normalized JPEG photo media'));
});

test('mailerlite validates all required campaign settings',()=>{
  const result=connectorPreflight(connector('mailerlite','{"from":"owner@example.com"}'));
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('MailerLite from_name is missing'));
  assert.ok(result.errors.includes('MailerLite group_id is missing'));
  assert.ok(result.errors.includes('MailerLite html_template is missing'));
});

test('invalid JSON and unsupported connector types fail closed',()=>{
  assert.equal(connectorPreflight(connector('buffer','{bad')).ok,false);
  assert.ok(connectorPreflight(connector('mystery')).errors.some(x=>x.startsWith('Unsupported connector type:')));
});
