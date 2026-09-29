# BUB Reward Machine — V1

**BUB Expo 2026** · 15–17 October 2026 · Sree Varalakshmi Mahal, Salem · organised by Aurix Events

`SCAN → PLAY → WIN → WHATSAPP → COUPON → LUCKY DRAW → STORY → SHARE`

Every hoarding, newspaper ad and notice carries its own QR code (`/play?src=H001`). Visitors pick one
of three BUB boxes, the server decides and reserves their reward, they verify their WhatsApp number
with a one-time code, get a unique coupon (`BUB-8F4K2Q`), enter the Lucky Draw (`BUB-LD-482917`), and
make a 1080×1920 Instagram story on their phone. Admins manage sources, sponsors, rewards, coupons,
participants, the draw and story templates; sponsors see only their own coupon numbers.

**All event facts, brand, Instagram links, title sponsor, WhatsApp settings and campaign status live in one file: [`src/config/bub.ts`](src/config/bub.ts).** Production readiness status: [`PRODUCTION_CHECKLIST.md`](PRODUCTION_CHECKLIST.md).

**Stack:** Next.js 16 · TypeScript · Tailwind CSS 4 · AWS Amplify · API Gateway + Lambda · DynamoDB · S3 · Cognito.
No Supabase.

---

## Contents

1. [Local setup](#1-local-setup)
2. [Environment variables](#2-environment-variables)
3. [AWS setup](#3-aws-setup)
4. [DynamoDB setup](#4-dynamodb-setup)
5. [Cognito setup](#5-cognito-setup)
6. [S3 setup](#6-s3-setup)
7. [API deployment](#7-api-deployment)
8. [WhatsApp integration](#8-whatsapp-integration)
9. [Production deployment](#9-production-deployment)
10. [QR source creation](#10-qr-source-creation)
11. [Sponsor onboarding](#11-sponsor-onboarding)
12. [How it works](#12-how-it-works) · [Security](#13-security) · [Testing](#14-testing) · [Project layout](#15-project-layout) · [Placeholders to replace](#16-placeholders-to-replace)

---

## 1. Local setup

Requires Node.js 20+ (22 recommended). No AWS account or WhatsApp credentials needed.

```bash
npm install
cp .env.example .env.local        # mock mode is on by default
npm run dev                       # http://localhost:3000
```

In mock mode (`AWS_MOCK_MODE=true`, `WHATSAPP_MOCK_MODE=true`):

- data lives in memory and resets when the server restarts. It is loaded with the **DEMO data set**
  (`src/lib/db/demo.ts`): 2 sponsors, 3 rewards with inventory, 3 QR sources (H001, N001, NT001),
  5 participants, 4 coupons (1 redeemed) and 3 Lucky Draw entries — plus the 4 built-in BUB story templates.
  Every demo record is identifiable: ids start with `demo_`, `is_demo: true`, names start with `[DEMO]`,
  coupon codes start with `BUB-DEMX`, Lucky Draw ids are `BUB-LD-9990xx`.
- WhatsApp messages are logged to the console, never sent. **The OTP is always `123456`.**
- `/login` offers demo accounts: `admin@demo.bub.local` (ADMIN), `title-sponsor@demo.bub.local` and
  `partner@demo.bub.local` (SPONSOR). Demo logins exist only in mock mode, and production builds refuse
  them unless `ALLOW_MOCK_LOGIN=true` (staging demos only).

Try the whole flow:

| URL | What |
|---|---|
| http://localhost:3000/?src=H001 | Landing page as scanned from hoarding H001 |
| http://localhost:3000/play?src=N001 | Straight into the game from the newspaper QR |
| http://localhost:3000/admin | Admin dashboard (sign in as admin@demo.bub.local) |
| http://localhost:3000/sponsor | Sponsor dashboard (sign in as a sponsor) |

> Coupons can only be redeemed inside their redemption window (by default the event dates, 15–17 Oct).
> To try redemption locally before then, set `NEXT_PUBLIC_EVENT_START_DATE` to today's date in
> `.env.local` and restart `npm run dev` (mock data re-seeds). A coupon keeps the window it was issued
> with. `NEXT_PUBLIC_*` values are baked in at build time, so production changes need a rebuild.

Quality gates (run before every commit / deploy):

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

---

## 2. Environment variables

Full annotated list: [`.env.example`](.env.example). Amplify does not allow the `AWS_` prefix, so every
`AWS_*` variable also accepts a `BUB_` alias (`BUB_AWS_MOCK_MODE`, `BUB_AWS_REGION`).

| Variable | Default | Notes |
|---|---|---|
| `AWS_MOCK_MODE` | `true` in dev, `false` in production | In-memory store + mock login |
| `WHATSAPP_MOCK_MODE` | `true` | Log only; OTP `123456` |
| `APP_BASE_URL` | `http://localhost:3000` | Used in QR links, coupon links, Cognito redirects |
| `SESSION_SECRET` | — | **Required in production**, 32+ chars. HMAC key for OTP hashes & mock tokens. The app refuses to start without it when mock mode is off |
| `NEXT_PUBLIC_EVENT_TIMEZONE` | `Asia/Kolkata` | Daily reward limits reset at local midnight |
| `NEXT_PUBLIC_EVENT_START_DATE` / `_END_DATE` | `2026-10-15` / `2026-10-17` | Default coupon redemption window |
| `NEXT_PUBLIC_CAMPAIGN_STATUS` | `live` | `paused` stops new plays (existing coupons still work); `ended` closes the campaign |
| `SEED_DEMO_DATA` | = `AWS_MOCK_MODE` | Load the DEMO data set. Never true in production |
| `ALLOW_MOCK_LOGIN` | `false` | Let a production build use demo logins (staging demos only) |
| `REWARD_HOLD_MINUTES` | `20` | How long a won box is reserved while the player verifies |
| `SPONSOR_SELF_REDEMPTION` | `false` | V1: only admins redeem |
| `TRUST_PROXY_HEADERS` | `true` | Read client IP from `X-Forwarded-For` (behind CloudFront/Amplify) |
| `API_PROXY_URL` | — | When set, `/api/*` is proxied to API Gateway + Lambda |
| `DYNAMODB_TABLE_NAME`, `BUB_AWS_REGION` | `bub-reward-machine`, `ap-south-1` | |
| `S3_ASSETS_BUCKET`, `ASSETS_PUBLIC_BASE_URL`, `S3_TEMP_BUCKET` | — | See §6 |
| `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_DOMAIN`, `COGNITO_CLIENT_SECRET` | — | See §5 |
| `WHATSAPP_*`, `OTP_*` | see file | See §8 |
| `NEXT_PUBLIC_*` | event copy | Event name, dates, venue, organiser, Instagram URLs/handles, logo, hero photo, terms link |

Nothing secret is ever prefixed `NEXT_PUBLIC_`; only those values reach the browser.

---

## 3. AWS setup

Everything except the website is one SAM stack: [`infra/template.yaml`](infra/template.yaml).
Recommended region: **ap-south-1 (Mumbai)**.

Prerequisites: AWS CLI v2 and SAM CLI, logged in to the target account.

```bash
# 1. Secrets (never put these in the template or git)
aws secretsmanager create-secret --name bub/session \
  --secret-string "{\"session_secret\":\"$(openssl rand -hex 48)\"}"
# later, when WhatsApp goes live:
aws secretsmanager create-secret --name bub/whatsapp \
  --secret-string '{"access_token":"…","phone_number_id":"…"}'

# 2. Build + deploy
npm ci
npm run build:lambda
cd infra
sam deploy --guided \
  --stack-name bub-reward-machine-prod \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    Stage=prod \
    AppBaseUrl=https://play.example.com \
    CognitoDomainPrefix=bub-expo-2026-admin \
    SessionSecretArn=arn:aws:secretsmanager:ap-south-1:123456789012:secret:bub/session-AbCdEf \
    WhatsAppMockMode=true
```

The stack creates: the DynamoDB table (PITR, encryption, deletion protection in prod), the assets
bucket + CloudFront, the private temp bucket (1-day expiry), the Cognito user pool, groups, app
client and hosted-UI domain, the HTTP API + Lambda, the 5-minute hold sweeper, and IAM policies
scoped to exactly those resources. Note the **Outputs** — you need them in §9.

---

## 4. DynamoDB setup

Single-table design with two GSIs and TTL — full access-pattern table and the list of atomic
invariants in [`infra/dynamodb/README.md`](infra/dynamodb/README.md). The SAM stack creates it; to
create it by hand use `infra/dynamodb/table.json`.

Seed the table:

```bash
# Production: baseline only — the 4 built-in BUB story templates. No sponsors, rewards or people.
DYNAMODB_TABLE_NAME=bub-reward-machine-prod BUB_AWS_REGION=ap-south-1 npm run seed:dynamo
# Staging walkthroughs: baseline + the DEMO data set
DYNAMODB_TABLE_NAME=bub-reward-machine-staging npm run seed:dynamo -- --demo
```

The script refuses to load DEMO data into any table whose name contains `prod` (unless `--force`).
Real sponsor names, quantities and values are entered by the BUB/Aurix team in the admin, not the code.

For local development against DynamoDB Local: set `AWS_MOCK_MODE=false`,
`DYNAMODB_ENDPOINT=http://localhost:8000`, create the table from `table.json`, and run the seed script.

---

## 5. Cognito setup

Created by the stack: user pool (email sign-in, admin-created users only, optional TOTP MFA, 12-char
passwords), groups **ADMIN** and **SPONSOR**, a public app client using the authorization-code
flow with PKCE, and a Hosted UI domain.

- Callback URL: `${APP_BASE_URL}/api/auth/callback` · Sign-out URL: `${APP_BASE_URL}/`
  (add `http://localhost:3000/...` to the app client too if you want to test Cognito locally).
- Set `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_DOMAIN` from the stack outputs.

Create users with the script (it creates the Cognito user, adds the group, and writes the
server-side role mapping):

```bash
export COGNITO_USER_POOL_ID=ap-south-1_XXXX DYNAMODB_TABLE_NAME=bub-reward-machine-prod BUB_AWS_REGION=ap-south-1
npm run create:user -- --email ops@aurix.example --role ADMIN
```

Every dashboard request verifies the ID token signature, issuer, audience and expiry server-side
(`aws-jwt-verify`). Hiding things in the UI is never relied on.

---

## 6. S3 setup

| Bucket | Purpose | Access |
|---|---|---|
| **Assets** | Sponsor logos, story template artwork uploaded in Admin | Private; served via CloudFront (OAC) with CORS so the story canvas can export. Admin uploads use 5-minute presigned PUT URLs limited to `logos/*` and `templates/*` |
| **Temp** | Reserved for any future server-side photo processing | Private, blocked public access, objects expire after **1 day** |

**Selfies are never uploaded in V1.** The story is composed on the phone with `<canvas>`, so photos
stay on the device; the server only counts that a story was generated.

Set `S3_ASSETS_BUCKET`, `ASSETS_PUBLIC_BASE_URL` (CloudFront URL) and `S3_TEMP_BUCKET` from the outputs.

---

## 7. API deployment

The API is a single route table (`src/lib/api/routes.ts`) with two adapters:

- **Next.js** — `src/app/api/[...path]/route.ts` (local dev, and a fallback in production)
- **AWS Lambda** — `infra/lambda/api.ts` behind API Gateway HTTP API (`ANY /api/{proxy+}`)

```bash
npm run build:lambda && (cd infra && sam deploy)
```

Set `API_PROXY_URL` = stack output `ApiUrl` in Amplify. Next.js then proxies `/api/*` to API Gateway,
so the browser stays same-origin (httpOnly cookies work, no CORS). Endpoint docs: [`docs/API.md`](docs/API.md).

---

## 8. WhatsApp integration

All messaging goes through `WhatsAppService` (`src/lib/whatsapp/service.ts`):
`sendOTP()`, `verifyOTP()`, `sendRewardMessage()`, `sendCouponMessage()`, `sendEventReminder()`.

- **Mock mode** (`WHATSAPP_MOCK_MODE=true`): messages are logged, not sent; OTP is `123456`.
- **Live** — pick the provider with `WHATSAPP_PROVIDER`; the frontend flow is identical for both:
  - `meta_cloud` — WhatsApp Business **Cloud API** (`POST {WHATSAPP_API_BASE_URL}/{phone-number-id}/messages`),
    credentials `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.
  - `msg91` — MSG91 WhatsApp outbound templates, credentials `MSG91_AUTH_KEY`, `MSG91_INTEGRATED_NUMBER`
    (+ `MSG91_TEMPLATE_NAMESPACE`). Compare `buildMsg91Body` with the sample request MSG91 shows for each
    approved template before going live.
  - Anything else: add a class implementing `WhatsAppProvider` in `src/lib/whatsapp/providers.ts`.
- OTPs are only sent to countries listed in `WHATSAPP_ALLOWED_COUNTRIES` (default `IN`).

Templates to get approved in WhatsApp Manager (names are configurable):

| Env var | Default name | Category | Body variables |
|---|---|---|---|
| `WHATSAPP_TEMPLATE_OTP` | `bub_otp` | Authentication (copy-code button) | `{{1}}` code |
| `WHATSAPP_TEMPLATE_COUPON` | `bub_coupon_code` | Utility | `{{1}}` name · `{{2}}` code · `{{3}}` reward · `{{4}}` valid until · `{{5}}` coupon link |
| `WHATSAPP_TEMPLATE_REWARD` | `bub_reward_won` | Utility | `{{1}}` name · `{{2}}` reward · `{{3}}` sponsor |
| `WHATSAPP_TEMPLATE_REMINDER` | `bub_event_reminder` | Marketing/Utility | `{{1}}` name · `{{2}}` event · `{{3}}` dates · `{{4}}` venue |

Going live: store the provider credentials in the `bub/whatsapp` secret
(`access_token` + `phone_number_id` for Meta, `auth_key` + `integrated_number` for MSG91), redeploy with
`WhatsAppSecretArn=…` and `WhatsAppMockMode=false`, set `WHATSAPP_MOCK_MODE=false` in Amplify,
then use **Admin → Overview → WhatsApp check** to send a test.

Honesty rules built in: the app reports `ACCEPTED` only when the provider returns a message ID, and
the UI never says a message was *delivered* (delivery receipts arrive via webhooks, a V2 item).
OTPs are 6 digits, stored only as an HMAC, expire in 10 minutes, allow 5 attempts, 30 s resend
cooldown and 5 sends per number per hour.

---

## 9. Production deployment

1. Deploy the SAM stack (§3) and note its outputs.
2. **Amplify Hosting** → *New app* → connect the git repo → it picks up [`amplify.yml`](amplify.yml).
   Platform: *Web Compute* (Next.js SSR), Node 22.
3. Environment variables in Amplify (all branches or per branch):

   ```
   BUB_AWS_MOCK_MODE=false
   WHATSAPP_MOCK_MODE=true            # until templates are approved
   APP_BASE_URL=https://play.example.com
   API_PROXY_URL=<ApiUrl output>
   SESSION_SECRET=<same value as the bub/session secret>
   COGNITO_USER_POOL_ID=… COGNITO_CLIENT_ID=… COGNITO_DOMAIN=…
   DYNAMODB_TABLE_NAME=… BUB_AWS_REGION=ap-south-1
   NEXT_PUBLIC_INSTAGRAM_BUB_URL=…  NEXT_PUBLIC_INSTAGRAM_ORGANIZER_URL=…  NEXT_PUBLIC_INSTAGRAM_TITLE_SPONSOR_URL=…
   NEXT_PUBLIC_BUB_LOGO_URL=…        (optional) NEXT_PUBLIC_HERO_IMAGE_URL=…  NEXT_PUBLIC_TERMS_URL=…
   ```

   `amplify.yml` copies the server-side variables into `.env.production` at build time (Amplify's
   documented way to expose them to Next.js server code) and runs typecheck + tests before building.
4. Add the custom domain in Amplify; make sure `AppBaseUrl` / `APP_BASE_URL` and the Cognito callback
   URL match it exactly.
5. Create the first admin (§5), sign in at `/admin`, enter the real sponsors and rewards (production tables contain no demo data), set up
   sources and download the QR codes (§10).
6. Smoke test on a real phone: scan → play → verify → coupon → Lucky Draw → story.

*Alternative without API Gateway:* leave `API_PROXY_URL` empty and give the Amplify SSR compute role
DynamoDB + S3 access to the same resources; the Next.js routes run the identical code.

Operational notes: DynamoDB PITR is on; API Gateway throttles at 200 rps (burst 400); the Lambda has
reserved concurrency 200; the sweeper runs every 5 minutes; logs go to CloudWatch (no OTPs, secrets
or full phone numbers are logged).

---

## 10. QR source creation

1. **Admin → Sources / QR → New source**: ID (e.g. `H003`), type (HOARDING / NEWSPAPER / NOTICE /
   SOCIAL / OTHER), name, location.
2. Click **PNG** (1200 px) or **SVG** (vector, best for print) to download that source's QR. It
   encodes `${APP_BASE_URL}/play?src=H003`.
3. Every placement gets its own ID; all codes open the same page. Deactivating a source stops
   attribution (visits count as direct) without breaking the printed code.

The dashboard reports **QR scans** (visits through a QR link), sessions, plays, leads (verified
WhatsApp numbers) and rewards per source. A scan is never presented as physical reach.

---

## 11. Sponsor onboarding

1. **Admin → Sponsors → New sponsor**: name, logo (upload or URL), Instagram URL, *title sponsor* flag.
2. **Admin → Rewards → New reward** for that sponsor: name, type, quantity, daily limit, winnable window,
   coupon redemption window, selection weight. Pause any time with **Pause**.
3. Create the sponsor's login (copy the `sponsor_id` shown under the sponsor name):

   ```bash
   npm run create:user -- --email team@sponsor.example --role SPONSOR --sponsor spn_abc123
   ```

4. The sponsor signs in at `/sponsor` and sees only **Coupon inventory** (total / claimed / remaining /
   redeemed) and **Coupon redemptions** (code, status, redeemed time) for their own rewards.
   Scoping is enforced on the server from the verified identity.

In V1, coupons are redeemed by the BUB/Aurix team at **Admin → Coupons → Redeem at the stall**.
`SPONSOR_SELF_REDEMPTION=true` lets sponsors redeem their own codes via the API when you're ready.

---

## 12. How it works

**Reward allocation (server-only).** Opening a box calls `POST /api/play`. The server filters rewards
that are active, within their winnable window, from an active sponsor, in stock and under today's
limit, then orders them randomly with probability ∝ *weight × remaining units*. It tries to **hold**
one unit in a single DynamoDB transaction that decrements stock and the daily counter only if both
conditions still hold, writes the play and a unique coupon (status ISSUED, code hidden), and binds the
play to the session. If that reward just ran out, it tries the next; if none are left it uses a
fallback reward; if even that is gone the play is recorded as NONE (the player can still complete the
machine and enter the draw).

**Claim.** After OTP verification, `POST /api/reward/claim` runs one transaction: lock the phone
number as "claimed" (conditional), HELD→CLAIMED, coupon ISSUED→CLAIMED, `claimed_count + 1`. A number
that already claimed gets its original reward back, never a second. Holds that aren't claimed within
`REWARD_HOLD_MINUTES` are swept back into stock (coupon → CANCELLED).

**Coupon lifecycle.** ISSUED (held) → CLAIMED (verified) → REDEEMED, or → CANCELLED (hold expired) /
EXPIRED (past `valid_until`). Codes use a 30-symbol unambiguous alphabet (`BUB-` + 6, ~729M codes),
uniqueness enforced by a conditional write with retry.

**Lucky Draw.** Requires a verified number that has completed the machine and ticked
"I've followed all 3". The confirmation is stored (`followed_*_confirmed`); it is not verified with
Instagram. Winners are picked with `crypto.randomInt` over entries not yet drawn; admins confirm,
change the prize or redraw with a reason. CSV export for the ceremony.

**Story generator.** Selfie via the native camera input (`capture="user"`, no permission prompt of our
own) or upload. Rendered at 1080×1920 on the device: template background → photo → template overlay →
dynamic fields (branding, vibe, event, dates, venue, optional reward, sponsor logo, #MyBUBStory).
Download, native share sheet (WhatsApp / Instagram on most phones), or a WhatsApp link fallback with
Instagram instructions. No direct Instagram publishing.

**Templates from Media Mileage.** In **Admin → Story Templates**, upload a 1080×1920 background and/or
a transparent overlay PNG, set the photo window (x, y, w, h), pick colours and which dynamic fields the
app should draw, and check the live preview. No code change needed.

---

## 13. Security

- No AWS or WhatsApp secret reaches the browser; DynamoDB is never exposed to the frontend.
- All inputs validated (zod on admin writes; strict checks on public inputs); phone numbers normalised to E.164 and must be mobiles.
- Rate limits (DynamoDB-backed fixed windows) on session, play, participant, OTP send/verify, claim,
  coupon lookup, lucky draw and story endpoints, plus API Gateway throttling.
- Inventory, one-claim-per-number, unique coupons, single Lucky Draw entry and single redemption are
  all enforced by conditional DynamoDB transactions — see `infra/dynamodb/README.md`.
- Admin and sponsor authorisation happens server-side on every request; sponsor scope comes from the
  verified identity only.
- Participant data is minimal (name, WhatsApp number, source, session); numbers are masked in admin
  lists. Full numbers appear only for drawn Lucky Draw winners and in the admin CSV export.
- Held coupon codes are never revealed or look-up-able before the claim; public coupon lookups return no personal data.
- CSV export guards against spreadsheet formula injection.
- Security headers (nosniff, frame deny, referrer policy, permissions policy).

---

## 14. Testing

```bash
npm test            # vitest — 106 tests
```

| Required area | File |
|---|---|
| 1 Source tracking | `tests/tracking.test.ts` |
| 2 One play per number | `tests/rewards.test.ts` |
| 3 Inventory decrement (+ hold expiry) | `tests/rewards.test.ts` |
| 4 Daily limit (incl. IST midnight) | `tests/rewards.test.ts` |
| 5 Concurrent claims — 50 players / 5 units, concurrent daily cap, same number from two sessions | `tests/rewards.test.ts` |
| 6 Unique coupon generation + collision retry | `tests/coupons.test.ts`, `tests/coupon-collision.test.ts` |
| 7 Coupon redemption (incl. concurrent, windows, sponsor rules) | `tests/coupons.test.ts` |
| 8 Lucky Draw eligibility | `tests/lucky-draw.test.ts` |
| 9 Duplicate Lucky Draw prevention | `tests/lucky-draw.test.ts` |
| 10 Sponsor data isolation | `tests/auth.test.ts` |
| 11 Admin authorisation (every admin route) | `tests/auth.test.ts` |
| 12 Expired reward · 13 Inactive reward · 14 Fallback reward | `tests/rewards.test.ts` |
| The 16 production-readiness scenarios (new participant → QR tracking) | `tests/production-readiness.test.ts` |
| Demo data set, central config, photo validation, MSG91 mapping | `tests/demo-config.test.ts` |
| `.env.example` matches the code | `tests/env-docs.test.ts` |
| DynamoDB transaction contracts | `tests/dynamo-repository.test.ts` |
| Lambda adapter | `tests/lambda.test.ts` |

The in-memory repository yields to the event loop before every critical section, so concurrent
tests genuinely interleave. The DynamoDB tests assert the exact condition expressions each
transaction sends; run a final check against a real table in staging before the event.

---

## 15. Project layout

```
src/
  app/                    pages: / · /play · /reward · /lucky-draw · /story · /admin · /sponsor · /login
    api/[...path]/        Next.js adapter for the shared API
  components/
    bub/                  brand, buttons, progress, shell, BUB box
    reward/               coupon card
    story/                1080×1920 canvas renderer
    forms/                inputs
    admin/                dashboard UI + sections
  lib/
    api/                  route table, HTTP types, dispatcher
    aws/                  DynamoDB repository, S3 uploads
    db/                   repository interface, in-memory store, demo.ts (DEMO data), baseline.ts (templates)
    rewards/              reward engine (allocation, claim, sweeper)
    coupons/  lucky-draw/  tracking/  whatsapp/  story/  admin/  sponsor/  auth/
  config/                 server + public config
  types/                  domain types
infra/
  template.yaml           SAM: DynamoDB, S3, CloudFront, Cognito, HTTP API, Lambdas
  lambda/                 api + sweeper handlers, esbuild script
  dynamodb/               table definition + access patterns
  api/                    deployment notes
scripts/                  seed-dynamo, create-dashboard-user
docs/API.md               endpoint reference
tests/                    vitest suites
```

---

## 16. Placeholders to replace

| Placeholder | Where |
|---|---|
| BUB logo (wordmark placeholder) | `NEXT_PUBLIC_BUB_LOGO_URL` |
| Campaign photo on landing | `NEXT_PUBLIC_HERO_IMAGE_URL` |
| Brand colours (official palette is set) | `src/config/bub.ts` → `brand.colors` |
| Instagram URLs / handles | `NEXT_PUBLIC_INSTAGRAM_*` |
| Sponsors, logos, rewards, quantities, values | Admin → Sponsors / Rewards (production starts empty; demo records are tagged [DEMO]) |
| Story templates (Media Mileage) | Admin → Story Templates |
| Coupon / terms copy | `NEXT_PUBLIC_TERMS_URL`; coupon card text in `src/components/reward/CouponCard.tsx` |
| WhatsApp credentials + approved templates | §8 |

**Not in V1** (V2 candidates): sponsor analytics beyond coupons, heatmaps, stall QR tracking,
leaderboards, treasure hunt, multiple games, direct Instagram publishing, AI images, referrals,
WhatsApp inbox, CRM, payments, delivery-receipt webhooks.
