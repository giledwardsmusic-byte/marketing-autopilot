# First Live Publishing Test

Purpose: prove the next real social-media post can travel end-to-end through Marketing Autopilot without weakening the $0 cost ceiling, media safety rules, or rollback path.

## Current first route

Facebook is already connected, so the next live verification target is direct Instagram (`meta_instagram`). Do not skip ahead to Pinterest or TikTok before Instagram is authorized and verified.

## Preconditions

- Production deployment is healthy.
- Database migrations/schema bootstrap complete successfully.
- Cost control remains at `approved_monthly_cost_cents: 0`.
- Real Table Rock Press copy is loaded from the designated Google Drive Marketing Copy Bank.
- The selected creative is a real approved Table Rock Press asset.
- Original media is preserved and any normalized derivative is reversible.
- Media preflight passes, or the original asset is technically valid for Instagram under the quota-fallback rule.
- Exactly one real Instagram connector is enabled for the target account.
- The connector has:
  - `connector_type: meta_instagram`
  - `platform: instagram`
  - a stored encrypted access token
  - `config_json.ig_user_id`
  - `cost_cents_per_post: 0`
- Sandbox remains available for non-live validation.
- No paid service is enabled.

## Test

1. Select one real Table Rock Press post only.
2. Confirm its copy came from the Marketing Copy Bank and its creative is approved.
3. Run media normalization/preflight for Instagram.
4. Set the single post to approved and due.
5. Allow the normal scheduler to process it once.
6. Verify the Instagram media container reaches `FINISHED` before `media_publish` is called.
7. Verify the scheduled-post row becomes `published`, not `simulated`, `pending`, or `failed`.
8. Verify `external_post_id` is populated.
9. Open Instagram and verify the post exists on the intended account with the expected creative/copy.
10. Verify connector health and audit history show success.
11. Verify monthly publishing cost remains 0 cents.
12. Verify no unresolved Needs Attention event was created for this post.

## Media fallback behavior

If Cloudflare image transformation fails or returns quota error 9422:

- Validate the original source asset against Instagram's technical acceptance rules.
- If valid, publish the original instead and create/log a warning alert that normalization was bypassed.
- If invalid, do not publish. Keep the post queued/paused for retry and immediately create a Needs Attention/email alert.

A transformation quota failure alone must never silently stop a technically valid post.

## Pass criteria

The test passes only if all of these are true:

- One and only one real Instagram post appears.
- It uses verified Table Rock Press content.
- The media container reached a publishable state before final publish.
- The scheduled-post row is `published`.
- The connector recorded success and external post ID.
- The audit trail records the publish.
- Media normalization or safe original-media fallback behaved as designed.
- No paid route was used.

## Failure handling

If authorization, media preflight, container processing, or the final API call fails, fail closed for that post, preserve its retry state, record the error, and create Needs Attention. Do not raise the cost ceiling and do not bypass acceptance checks.

## Immediate rollback

Disable the real Instagram connector (`enabled = 0`). Sandbox and other non-live system functions can remain enabled.

## Expansion order

After Instagram passes, repeat the same one-post verification pattern for Pinterest, then TikTok. TikTok additionally requires final outcome reconciliation: only `PUBLISH_COMPLETE` counts as published.