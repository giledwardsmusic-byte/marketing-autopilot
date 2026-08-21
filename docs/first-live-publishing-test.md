# First Live Publishing Test

Purpose: prove one real social-media post can travel end-to-end through Marketing Autopilot without weakening the existing $0 cost ceiling or sandbox fallback.

## Preferred first route

Use the direct Facebook connector (`meta_facebook`) for the first live test. It has the fewest creative constraints of the direct social routes and can publish either text-only or with an approved image.

## Preconditions

- Production deployment is healthy.
- Database migrations/schema bootstrap complete successfully.
- Cost control remains at `approved_monthly_cost_cents: 0`.
- Sandbox connectors remain enabled as a safe fallback.
- Exactly one real Facebook connector is enabled for the target page.
- The real connector has:
  - `connector_type: meta_facebook`
  - `platform: facebook`
  - a stored encrypted access token
  - `config_json.page_id`
  - `cost_cents_per_post: 0`
  - higher priority than the sandbox Facebook connector.
- The post selected for the test is approved and contains harmless test marketing copy.

## Test

1. Create or select one Facebook scheduled post only.
2. Set it to `approved` and make it due.
3. Allow the normal scheduler to process it once.
4. Verify the database row becomes `published`, not `simulated` or `failed`.
5. Verify `connector_type` is `meta_facebook` and `external_post_id` is populated.
6. Open Facebook and verify the post exists on the intended page.
7. Verify the matching connector has `last_success_at` populated and no new `last_error`.
8. Verify the audit log contains the successful publish event.
9. Verify monthly publishing cost remains 0 cents.

## Pass criteria

The test passes only if all of these are true:

- One and only one real Facebook post appears.
- The scheduled-post row is `published`.
- The connector recorded success.
- The external post ID is stored.
- The app audit trail records the publish.
- No paid route was used.

A `simulated` result does not count as a live-test pass; it means the system correctly fell back to sandbox.

## Failure handling

If the real connector fails preflight or the API call fails, leave sandbox fallback intact, record the connector error, and fix only the failing requirement. Do not raise the cost ceiling and do not disable the existing safety checks.

## Immediate rollback

To stop further real publishing while preserving the rest of the app, disable the real connector (`enabled = 0`). The sandbox route can remain enabled so scheduling and campaign generation continue to be testable without external posting.

## Before expanding to other platforms

Do not connect Instagram or Pinterest until this Facebook test passes. Once it passes, repeat the same pattern one platform at a time, checking the stored external ID, audit event, connector health, and zero-cost control after each test.
