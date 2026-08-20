# Marketing Autopilot

Marketing Autopilot is a mobile-first, free-first marketing control system built for Cloudflare Workers, D1, and R2.

The owner adds products and existing advertising graphics. The app organizes the library, creates or reuses grounded marketing copy, builds weekly campaigns, rotates products and creative, schedules posts, tracks results, switches publishing routes when a zero-cost equivalent is available, and continues in Autopilot when the owner does nothing.

## Core behavior

- Product catalog for books, apps, downloads, music products, services, and future product types
- Bulk graphic upload to R2 with exact duplicate detection
- AI-assisted asset classification with a no-cost heuristic fallback
- Reusable copy library
- AI provider abstraction for OpenAI, Anthropic, or no-cost grounded copy
- Weekly campaign generation and creative rotation
- Automatic product weighting based on exposure and performance
- Autopilot scheduling through Cloudflare Cron
- Publishing adapters for Buffer, direct Facebook, direct Instagram, Pinterest, MailerLite, plus a safe sandbox route
- Automatic publishing-route fallback inside the approved cost ceiling
- AES-GCM encryption for stored connector credentials
- Tracked redirect URLs with UTM parameters
- Payhip sale/refund webhook ingestion
- Performance tracking and gradual posting-frequency optimization
- Broken-link checks with automatic product pause after repeated failure
- Daily metadata backup to R2
- Continuity administrator accounts
- Human-readable health, cost, performance, audit, and Needs Attention screens
- Responsive phone and Chromebook interface

No spreadsheet is part of the normal workflow.

## Architecture

```text
Browser
  -> Cloudflare Worker
      -> D1: products, creative metadata, copy, campaigns, metrics, settings
      -> R2: advertising graphics and metadata backups
      -> AI adapter: OpenAI / Anthropic / no-cost fallback
      -> Campaign engine
      -> Cron scheduler
      -> Publishing adapters
          -> Buffer
          -> Meta Facebook
          -> Meta Instagram
          -> Pinterest
          -> MailerLite
          -> Sandbox
```

## Free-first rule

The default approved automation budget is $0.

The system may automatically switch between equivalent zero-cost publishing routes. It may not increase the approved spending ceiling on its own. Paid AI or paid publishing is blocked unless the owner raises the cost ceiling.

## One-time Cloudflare setup

### 1. Install

```bash
npm install
```

### 2. Create D1

```bash
npx wrangler d1 create marketing-autopilot
```

Copy the returned database ID into `wrangler.toml` in place of `REPLACE_WITH_D1_DATABASE_ID`.

### 3. Create R2

```bash
npx wrangler r2 bucket create marketing-autopilot-media
```

### 4. Apply the database migration

```bash
npm run db:remote
```

### 5. Add owner/security secrets

Set these Worker secrets:

```bash
npx wrangler secret put BOOTSTRAP_ADMIN_EMAIL
npx wrangler secret put BOOTSTRAP_ADMIN_PASSWORD
npx wrangler secret put CREDENTIAL_ENCRYPTION_KEY
```

The bootstrap password must be at least 12 characters.

Generate a 32-byte encryption key with:

```bash
openssl rand -base64 32
```

### 6. Deploy

```bash
npm run deploy
```

Open the deployed site and choose **Initialize owner account** once. After that, sign in normally.

## Optional AI

The default configuration is:

```text
AI_PROVIDER=none
```

That allows the system to operate without paid AI by producing conservative copy from verified product facts.

To enable AI later, set `AI_PROVIDER` to `openai` or `anthropic`, specify `AI_MODEL`, and add the matching Worker secret:

```bash
npx wrangler secret put OPENAI_API_KEY
```

or

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Paid AI calls still remain blocked unless the owner-approved monthly cost ceiling allows them.

## Publishing connectors

Publishing routes are added inside **Settings**. Tokens are encrypted server-side and are never returned to the browser.

### Buffer

Connector type: `buffer`

Configuration example:

```json
{"channel_id":"BUFFER_CHANNEL_ID"}
```

### Direct Facebook

Connector type: `meta_facebook`

```json
{"page_id":"FACEBOOK_PAGE_ID","api_version":"v25.0"}
```

### Direct Instagram

Connector type: `meta_instagram`

```json
{"ig_user_id":"INSTAGRAM_PROFESSIONAL_ACCOUNT_ID","api_version":"v25.0"}
```

Direct Instagram publishing requires an eligible Professional account. The direct adapter currently requires JPEG creative; if that route cannot use an asset, another eligible route can be tried.

### Pinterest

Connector type: `pinterest`

```json
{"board_id":"PINTEREST_BOARD_ID"}
```

### MailerLite

Connector type: `mailerlite`

```json
{"from":"verified@example.com","from_name":"Your Brand","group_id":"GROUP_ID","html_template":"<p>{{CONTENT}}</p>"}
```

MailerLite API capabilities can vary by account/plan. Keep this route disabled if the account cannot create campaigns through the API.

### Sandbox

Connector type: `sandbox`

The sandbox route does not claim to publish anything externally. It marks scheduled items as simulated so the campaign engine, scheduler, cost controls, and fallback logic can be tested safely before real social credentials are connected.

## Payhip tracking

Set the Payhip API key:

```bash
npx wrangler secret put PAYHIP_API_KEY
```

Then configure a Payhip webhook pointing to:

```text
https://YOUR-APP-DOMAIN/webhooks/payhip
```

Marketing Autopilot verifies the webhook signature and records paid/refunded events. Tracking redirects also add UTM parameters automatically.

## Scheduling and optimization

The starting cadence is stored in D1 rather than buried permanently in UI code. The default migration starts with platform-specific posting levels and a nightly optimizer adjusts gradually only after minimum evidence thresholds are reached.

The default timezone is `America/Chicago` and is editable in Settings.

## Failure behavior

- One failed social platform does not stop the others.
- One broken product URL does not stop other products.
- AI failure falls back to existing or no-cost grounded copy.
- A publishing route failure can fall through to the next eligible route.
- A paid route above the approved cost ceiling is skipped.
- Product links are checked repeatedly before automatic pause.
- Connector errors appear in Needs Attention.
- Daily metadata backups are written to R2.

## Tests

Run unit tests:

```bash
npm test
```

After deployment, run the smoke test with owner credentials:

```bash
MA_BASE_URL=https://YOUR-APP-DOMAIN \
MA_EMAIL=you@example.com \
MA_PASSWORD='your-password' \
npm run smoke
```

The smoke test checks login, product CRUD, copy creation, asset upload, exact duplicate detection, cost controls, and timezone configuration.

## Repository structure

```text
public/                 mobile web interface
src/index.js            Worker routes, scheduler, tracking and system jobs
src/lib/                auth, security, DB helpers, AI, campaign and publishing layers
migrations/             D1 schema and default policies
scripts/smoke.mjs       deployed-system smoke test
test/                    unit tests
docs/ARCHITECTURE.md    design notes
wrangler.toml           Cloudflare bindings and cron configuration
```

## Definition of the normal owner workflow

1. Add products.
2. Upload existing advertising graphics.
3. Let the system organize and rotate them.
4. Add or generate reusable copy.
5. Build/review the upcoming week if desired.
6. Walk away.
7. Autopilot continues within approved rules and cost limits.
8. Return later to see what was used, what failed, and what produced results.
