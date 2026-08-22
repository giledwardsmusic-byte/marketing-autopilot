# Platform rollout gate

Order: Facebook (already connected) -> Instagram -> Pinterest -> TikTok.

## Safety gate before any live post

1. Use only verified Table Rock Press content from the configured Google Drive source.
2. Import approved copy into the reusable copy bank.
3. Load approved creative into R2/D1 and confirm public-media delivery.
4. Generate a campaign and run it through the sandbox connector.
5. Verify caption, graphic, product link, tracking redirect, cost ceiling, audit log, and duplicate rotation.
6. Only then enable one live test post on one platform.

## Instagram

The direct Meta Instagram adapter is implemented. Reuse the existing Meta app/token where permissions permit. Required connector config:

```json
{"ig_user_id":"INSTAGRAM_PROFESSIONAL_ACCOUNT_ID","api_version":"v25.0"}
```

Required one-time external state: eligible Instagram Professional account connected to the Meta business/Page and a token with publishing permission. Do not ask for this until the sandbox content gate is green.

## Pinterest

The direct Pinterest v5 Pin adapter is implemented. Required connector config:

```json
{"board_id":"PINTEREST_BOARD_ID"}
```

Required one-time external state: Pinterest developer authorization/access token and target board ID. Keep disabled until Instagram is verified.

## TikTok

TikTok is intentionally not treated as live-ready yet. Before implementing/enabling direct posting, verify the current TikTok Content Posting API eligibility, scopes, media rules, audit requirements, and app approval state. Until then, TikTok content can be prepared in the campaign queue but must not be marked published by a fake connector.

## Free-tier rule

All connector costs remain zero by default. No paid publishing or AI route may be enabled unless the owner explicitly raises the approved monthly cost ceiling.
