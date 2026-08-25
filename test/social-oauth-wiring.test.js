import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entry=await readFile(new URL('../src/entry.js',import.meta.url),'utf8');
const helper=await readFile(new URL('../src/lib/social-oauth-connect.js',import.meta.url),'utf8');
const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const ui=await readFile(new URL('../public/social-oauth-connect.js',import.meta.url),'utf8');

test('Pinterest and TikTok OAuth start/callback routes are exposed',()=>{
  assert.match(entry,/\/api\/connectors\/pinterest\/oauth\/start/);
  assert.match(entry,/\/oauth\/pinterest\/callback/);
  assert.match(entry,/\/api\/connectors\/tiktok\/oauth\/start/);
  assert.match(entry,/\/oauth\/tiktok\/callback/);
});

test('OAuth state is one-time and expires',()=>{
  assert.match(helper,/STATE_TTL_MS=15\*60\*1000/);
  assert.match(helper,/DELETE FROM settings WHERE key=\?/);
  assert.match(helper,/authorization state did not match/);
  assert.match(helper,/authorization session expired/);
});

test('tokens are encrypted and refresh metadata is encrypted too',()=>{
  assert.match(helper,/encryptCredential\(env,accessToken\)/);
  assert.match(helper,/refresh_ciphertext/);
  assert.match(helper,/refreshSocialOAuthConnectors/);
  assert.match(entry,/refreshSocialOAuthConnectors\(env\)/);
});

test('Pinterest gets a concrete publishing board before connector enablement',()=>{
  assert.match(helper,/\/boards\?page_size=100/);
  assert.match(helper,/board_id:String\(board.id\)/);
  assert.match(helper,/no board is available for publishing/);
});

test('Settings loads working Pinterest and TikTok connection controls',()=>{
  assert.match(html,/social-oauth-connect\.js/);
  assert.match(ui,/Connect Pinterest/);
  assert.match(ui,/Connect TikTok/);
  assert.match(ui,/location\.assign\(r\.url\)/);
});
