import fs from 'node:fs/promises';

const required = [
  'instagram_from_facebook',
  'pinterest_oauth',
  'tiktok_oauth',
  'google_drive_sync',
  'marketing_copy_bank',
  'paid_sale_email_alerts',
  'unresolved_health_email_alerts',
  'media_normalization',
  'media_quota_fallback',
  'invalid_media_fail_closed',
];

const raw = await fs.readFile(new URL('../public/release.json', import.meta.url), 'utf8');
const manifest = JSON.parse(raw);

if (!manifest.release_id || typeof manifest.release_id !== 'string') {
  throw new Error('release.json must contain a non-empty release_id');
}

const missing = required.filter((key) => manifest.capabilities?.[key] !== true);
if (missing.length) {
  throw new Error(`release.json is missing required capabilities: ${missing.join(', ')}`);
}

console.log(`Release manifest verified: ${manifest.release_id}`);
