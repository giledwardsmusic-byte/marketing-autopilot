import fs from 'node:fs/promises';

const base=(process.env.MA_BASE_URL||'https://marketing-autopilot.giledwardsmusic.workers.dev').replace(/\/$/,'');
const manifest=JSON.parse(await fs.readFile(new URL('../public/release.json', import.meta.url),'utf8'));
const expected=process.env.MA_RELEASE_ID||manifest.release_id;
const r=await fetch(`${base}/release.json`,{headers:{'cache-control':'no-cache'}});
if(!r.ok)throw new Error(`Live release probe failed (${r.status})`);
const data=await r.json();
if(data.release_id!==expected)throw new Error(`Deployment mismatch: live=${data.release_id||'unknown'} expected=${expected}`);
const required=[
  'instagram_from_facebook',
  'pinterest_oauth',
  'tiktok_oauth',
  'google_drive_sync',
  'marketing_copy_bank',
  'drive_media_ingestion',
  'drive_creative_product_scoping',
  'tracked_campaign_links',
  'payhip_sales_attribution',
  'paid_sale_email_alerts',
  'unresolved_health_email_alerts',
  'media_normalization',
  'persistent_derived_media',
  'media_quota_fallback',
  'invalid_media_fail_closed'
];
const missing=required.filter(k=>data.capabilities?.[k]!==true);
if(missing.length)throw new Error(`Live release is missing capabilities: ${missing.join(', ')}`);
console.log(`Live deployment verified: ${data.release_id}`);
