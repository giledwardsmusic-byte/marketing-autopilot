# Architecture Notes

## Design goals

1. Owner effort should approach one optional weekly review.
2. The system must continue when the owner is absent.
3. A local failure must not become a global failure.
4. Spending can optimize downward or sideways automatically, never upward without owner approval.
5. Marketing rules are updateable data, not permanent assumptions baked into the UI.
6. Product facts are the source of truth for AI-generated copy.
7. Existing creative is inventory to exploit before creating more inventory.

## Data flow

1. Product is entered once.
2. Graphics are bulk-uploaded to R2; D1 stores classification and history.
3. Copy is imported, written, or generated from verified product facts.
4. Campaign engine scores products, then least-recent/least-used appropriate creative and copy.
5. Weekly scheduled posts are written to D1.
6. Cloudflare Cron invokes the publishing layer every five minutes.
7. Publishing layer tries eligible connectors in priority/cost order.
8. Tracking redirects record qualified clicks.
9. Payhip webhooks record sale/refund events; Buffer metrics are pulled nightly.
10. Optimizer gradually adjusts posting frequency after minimum evidence.
11. Health, cost, and audit data are visible in plain language.

## Autopilot safety

Autopilot never creates unsupported product claims. If the AI service cannot run, deterministic grounded copy remains available. Experimental creative is capped by policy. A long period without owner activity can later be used to lower the experimental share without changing the campaign engine.

## Known external constraints

Real social publishing is controlled by the destination platforms. Some connections require app review, professional/business account types, OAuth permissions, or token renewal. The application isolates those requirements behind adapters and reports them as connection health, rather than spreading provider-specific logic throughout the app.

MailerLite API HTML campaign creation can be plan-dependent. The app does not pretend a free MailerLite account can do something its API refuses.

Instagram direct image publishing requires a supported public image format; the direct adapter currently enforces JPEG and falls through to another route when necessary.
