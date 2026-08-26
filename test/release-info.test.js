import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RELEASE_ID, RELEASE_CAPABILITIES, releaseInfo } from '../src/lib/release-info.js';

test('release manifest matches the static deployment marker', async()=>{
  const staticManifest=JSON.parse(await readFile(new URL('../public/release.json',import.meta.url),'utf8'));
  assert.equal(staticManifest.release_id,RELEASE_ID);
  assert.deepEqual(staticManifest.capabilities,RELEASE_CAPABILITIES);
  assert.deepEqual(releaseInfo(),staticManifest);
});

test('release manifest advertises required completion safeguards',()=>{
  for(const key of [
    'instagram_from_facebook','pinterest_oauth','tiktok_oauth','google_drive_sync',
    'marketing_copy_bank','drive_media_ingestion','drive_creative_product_scoping',
    'tracked_campaign_links','payhip_sales_attribution',
    'paid_sale_email_alerts','unresolved_health_email_alerts',
    'media_normalization','persistent_derived_media','media_quota_fallback','invalid_media_fail_closed'
  ]) assert.equal(RELEASE_CAPABILITIES[key],true,key);
});
