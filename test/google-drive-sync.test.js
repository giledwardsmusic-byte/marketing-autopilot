import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DRIVE_FOLDER_ID, driveSyncConfigured, parseCopyBank } from '../src/lib/google-drive-sync.js';

test('uses the designated Marketing Autopilot Drive folder',()=>{
  assert.equal(DEFAULT_DRIVE_FOLDER_ID,'13V50CtAtjWRZ0H_F9kBbjDdWBdsjxxDE');
});

test('Drive sync remains safely disabled until all OAuth secrets exist',()=>{
  assert.equal(driveSyncConfigured({}),false);
  assert.equal(driveSyncConfigured({GOOGLE_DRIVE_CLIENT_ID:'a',GOOGLE_DRIVE_CLIENT_SECRET:'b'}),false);
  assert.equal(driveSyncConfigured({GOOGLE_DRIVE_CLIENT_ID:'a',GOOGLE_DRIVE_CLIENT_SECRET:'b',GOOGLE_DRIVE_REFRESH_TOKEN:'c'}),true);
});

test('Marketing Copy Bank parser imports numbered copy and ignores inventory/status tail',()=>{
  const sample=`MARKETING COPY BANK - TABLE ROCK PRESS\n\nPurpose\nReusable copy.\n\n1. Courage\nBuddy once thought courage meant never being afraid.\n\nThen he learned to move forward.\n\n2. Quiet places\nThe forest changed him because he listened.\n#WhisperingForest\n\nAsset inventory now visible in Drive\nTable Rock Press logo\nStatus\nDrive read access: verified\n`;
  assert.deepEqual(parseCopyBank(sample),[
    {number:1,title:'Courage',text:'Buddy once thought courage meant never being afraid.\n\nThen he learned to move forward.'},
    {number:2,title:'Quiet places',text:'The forest changed him because he listened.\n#WhisperingForest'}
  ]);
});
