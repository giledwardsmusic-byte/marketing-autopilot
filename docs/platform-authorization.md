# Platform authorization completion runbook

This is the final external-account checklist for Marketing Autopilot. Do not publish live content until the Table Rock Press seed/copy bank and approved creative are present.

## Status meanings

- **Prepared**: publisher code and fail-closed preflight exist.
- **Authorized**: required platform token/IDs have been stored in the connector.
- **Verified**: connector preflight passes against approved Table Rock Press content.
- **Live**: a real post has successfully published and its external post ID was recorded.

Never call a platform connected merely because its code exists.

## 1. Instagram via Meta

Preferred next platform because it can reuse the existing Meta app/account path.

Connector type: `meta_instagram`

Required connector data:
- encrypted Meta/Instagram access token
- `config_json.ig_user_id`
- enabled connector
- approved JPEG creative with a public media token

Verification before first post:
1. Token is stored encrypted, never committed to GitHub.
2. `ig_user_id` is present.
3. Preflight passes with a real Table Rock Press JPEG.
4. First live test uses approved Marketing Copy Bank text and approved Table Rock Press art.
5. Record returned Instagram media ID and connector success timestamp.

Current state: prepared; external authorization/ID verification remains before live test.

## 2. Pinterest

Connector type: `pinterest`

Required connector data:
- encrypted Pinterest access token
- `config_json.board_id`
- enabled connector
- approved graphic with public media token

Verification before first Pin:
1. Token is stored encrypted.
2. Board ID is present.
3. Preflight passes using real Table Rock Press creative.
4. Tracking link is generated when a campaign tracking code exists.
5. Record returned Pin ID and connector success timestamp.

Current state: prepared; external authorization/board verification remains before live test.

## 3. TikTok

Connector type: `tiktok`

Required connector data:
- encrypted TikTok access token with Content Posting authorization
- `config_json.creator_id`
- approved supported media with a public HTTPS media URL

The direct-post core is wired into the generic publisher dispatcher. It queries creator information, validates an allowed privacy level, supports direct video/photo initialization as implemented, and can fetch post status. Platform-specific media normalization/fallback rules apply before the media URL reaches the connector.

Verification before first TikTok test:
1. Store token encrypted.
2. Confirm creator ID/config.
3. Confirm approved supported media.
4. Run preflight.
5. Query creator info before posting.
6. Use an allowed privacy setting; testing should remain private when platform/app status requires it.
7. Record publish ID and poll status.

Current state: prepared; external Content Posting authorization and creator/domain verification remain before live test.

## Google Drive source/archive

Canonical source/archive folder ID: `13V50CtAtjWRZ0H_F9kBbjDdWBdsjxxDE`

Marketing Copy Bank folder ID: `1CkL0vFmPvRQjh6gFkb6TQUD0jprwcPWX`

Marketing Copy Bank document ID: `173q8LAdNffIprY8DwULTryvy2bRj3IyZ5Mo4VhMwJxA`

Drive read and write access have been verified. The copy bank contains real Table Rock Press / Whispering Forest copy, including source-backed Buddy material and an inventory of Whispering Forest assets. The application seed must remain source-backed and idempotent.

## Notifications and media safety

- Needs Attention/health events and Payhip paid-sale events have notification code paths.
- Email is the preferred free-first external alert channel; SMS remains disabled unless cost is explicitly approved.
- Platform media variants are generated without modifying originals.
- Transformation/quota failure must validate the original before fallback. A valid original may publish with a warning; an invalid original must fail closed and raise Needs Attention rather than publish broken media.

## Live-test gate

A live publishing test is allowed only when all of these are true:
- real Table Rock Press copy is loaded and approved;
- real Table Rock Press creative is approved;
- target connector is authorized;
- connector preflight passes;
- monthly approved publishing cost remains within the configured ceiling;
- no placeholder content is used.

Platform order: Instagram, Pinterest, TikTok.
