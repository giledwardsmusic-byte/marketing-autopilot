import test from 'node:test';
import assert from 'node:assert/strict';
import { googleDriveRedirectUri, beginGoogleDriveOAuth } from '../src/lib/google-drive-oauth.js';

test('Google Drive OAuth uses the live worker callback URI',()=>{
  assert.equal(
    googleDriveRedirectUri('https://marketing-autopilot.giledwardsmusic.workers.dev/'),
    'https://marketing-autopilot.giledwardsmusic.workers.dev/oauth/google-drive/callback'
  );
});

test('Google Drive OAuth refuses to start without both client credentials',async()=>{
  await assert.rejects(()=>beginGoogleDriveOAuth({},'https://marketing-autopilot.giledwardsmusic.workers.dev'),/CLIENT_ID/);
  await assert.rejects(()=>beginGoogleDriveOAuth({GOOGLE_DRIVE_CLIENT_ID:'id'},'https://marketing-autopilot.giledwardsmusic.workers.dev'),/CLIENT_SECRET/);
});
