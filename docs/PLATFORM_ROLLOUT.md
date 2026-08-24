# Platform rollout gate

Order: Facebook (already connected) -> Instagram -> Pinterest -> TikTok.

## Safety gate before any live post

1. Use only verified Table Rock Press content from the configured Google Drive source folder.
2. Import approved copy into the Marketing Copy Bank.
3. Preserve original source creative and generate derived platform variants reversibly.
4. Preflight platform media acceptance before any publishing call.
5. Generate a campaign and run it through the sandbox path first.
6. Verify caption, creative, product link, tracking redirect, cost ceiling, audit log, duplicate rotation, and alerting.
7. Only then enable one live test post on the next authorized platform.

## Media normalization and fallback

- Pinterest: target approximately 2:3 portrait.
- Instagram: square/portrait variants.
- Facebook: flexible sizing without awkward cropping.
- TikTok: 9:16 vertical video/media where applicable.
- Originals are never overwritten; normalization creates derived variants.
- If Cloudflare transformation fails, including quota error 9422, validate the original asset against the destination platform's technical acceptance rules.
- If the original is valid, publish the original on schedule and create a warning/Needs Attention event that normalization was bypassed.
- If the original is invalid, fail closed for that post, keep it queued/paused, raise Needs Attention, and retry on a later run. Never send broken media.

## Instagram

The direct Meta Instagram adapter is implemented and wired into the live publisher path. It creates media containers, waits for Meta processing to reach a publishable state, and fails closed on processing errors, expiration, or timeout.

Required connector config:

```json
{"ig_user_id":"INSTAGRAM_PROFESSIONAL_ACCOUNT_ID","api_version":"v25.0"}
```

Required one-time external state: eligible Instagram Professional account connected to the Meta business/Page and a token with publishing permission. This is the next live authorization gate.

## Pinterest

The direct Pinterest v5 Pin adapter is implemented and wired into the live publisher path. It validates token, board ID, image URL, field limits, API errors, and returned Pin ID before accepting success.

Required connector config:

```json
{"board_id":"PINTEREST_BOARD_ID"}
```

Required one-time external state: Pinterest developer authorization/access token and target board ID. Keep disabled until Instagram is verified.

## TikTok

The direct TikTok publisher and outcome reconciliation path are implemented. Submission is not treated as final publication: `PUBLISH_COMPLETE` is required before the post is counted as published. Processing states remain pending; terminal failures create Needs Attention and preserve retry/failure state safely.

TikTok remains disabled until its one-time developer authorization, required scopes, and account/app eligibility are satisfied after Pinterest verification.

## Notifications

Every unresolved Needs Attention/health event is swept through the notification layer. Payhip paid-sale webhooks also trigger notification delivery. Deduplication is concurrency-safe; failed notification delivery releases the claim for retry. Email is the preferred free-tier path. SMS remains optional and disabled unless its cost is explicitly approved.

## Free-tier rule

All connector costs remain zero by default. No paid publishing, AI, SMS, or other paid route may be enabled unless the owner explicitly approves the exact cost and raises the approved monthly cost ceiling.