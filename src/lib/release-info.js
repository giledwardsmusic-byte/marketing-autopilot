export const RELEASE_ID='2026-08-26-drive-product-scope-v1';

export const RELEASE_CAPABILITIES=Object.freeze({
  facebook_connected_route:true,
  instagram_from_facebook:true,
  pinterest_oauth:true,
  tiktok_oauth:true,
  google_drive_sync:true,
  marketing_copy_bank:true,
  drive_media_ingestion:true,
  drive_creative_product_scoping:true,
  tracked_campaign_links:true,
  payhip_sales_attribution:true,
  paid_sale_email_alerts:true,
  unresolved_health_email_alerts:true,
  media_normalization:true,
  persistent_derived_media:true,
  media_quota_fallback:true,
  invalid_media_fail_closed:true
});

export function releaseInfo(){
  return {
    app:'Marketing Autopilot',
    release_id:RELEASE_ID,
    capabilities:{...RELEASE_CAPABILITIES}
  };
}
