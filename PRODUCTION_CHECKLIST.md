# BUB Reward Machine V1 — Production checklist

Event: **BUB Expo 2026 · 15–17 October 2026 · Sree Varalakshmi Mahal, Salem** (Aurix Events)
Status at this pass: **ready for staging.** Everything below "DONE" runs locally in mock mode and passes
typecheck, lint, 106 automated tests and the production build. Nothing has yet run against real AWS or
a real WhatsApp provider.

Legend: ✅ done · ⚙️ needs configuration · 📋 needs real data · 🧪 needs a staging test · 📅 before the event

---

## ✅ DONE — working now

**Brand & config**
- ✅ Official palette applied everywhere: background `#F3EEE4`, orange `#F0440F`, black `#111111`,
  white `#FFFFFF`, muted `#5A5752`, border `#D8D0C4`. Layout, type hierarchy, 3-box game, progress
  bar and CTA positions unchanged.
- ✅ One central config: `src/config/bub.ts` — event name, dates, venue, organiser, logo, colours,
  Instagram URLs, title sponsor, WhatsApp settings, campaign status (`live` / `paused` / `ended`).
  A test fails if a page or component hard-codes event facts.

**Data**
- ✅ Demo data is separate (`src/lib/db/demo.ts`) and tagged three ways (`demo_` ids, `is_demo`,
  `[DEMO]` names; codes `BUB-DEMX…`, draw ids `BUB-LD-9990xx`): 2 sponsors, 3 rewards with inventory,
  3 QR sources, 5 participants, 4 coupons (1 redeemed), 3 Lucky Draw entries, demo logins.
- ✅ Production baseline (`src/lib/db/baseline.ts`) seeds only the 4 BUB story templates.
- ✅ Seed script refuses to put demo data into a table named `*prod*`.

**Reward Machine**
- ✅ Reward chosen on the server only; the browser sends just the box number (0–2).
- ✅ Stock and daily limits are taken in one conditional DynamoDB transaction — can't go below zero,
  can't oversell (tested: 40–50 simultaneous players on 3–5 units → exactly 3–5 winners).
- ✅ Inactive, paused, expired, not-yet-valid, sold-out and inactive-sponsor rewards are never issued.
- ✅ Fallback reward takes over when stock runs out; if even that is gone the player can still finish.
- ✅ Unclaimed reservations return to stock after 20 minutes (scheduled sweeper every 5 min).
- ✅ Campaign `paused`/`ended` stops new plays; existing coupons keep working.

**One play per WhatsApp number**
- ✅ Enforced by a server-side lock on the normalised number (`PHONE#+91…`), not by browser storage.
  Covers repeat clicks, refresh, new browser/device, and two sessions claiming at the same moment.
  A number that already played gets its original reward back, never a second one.

**Coupons**
- ✅ Unique codes (`BUB-` + 6 unambiguous characters, uniqueness enforced by the database, retry on collision).
- ✅ Each coupon is tied to its sponsor and reward. Lifecycle ISSUED → CLAIMED → REDEEMED, or
  CANCELLED (reservation expired) / EXPIRED (past valid-until).
- ✅ Blocks double redemption (incl. simultaneous), redemption before/after the window, and redemption
  of another sponsor's coupon. Unclaimed codes can't be looked up.

**Sponsor isolation**
- ✅ Sponsors see only their own coupon inventory and redemptions. Their sponsor comes from the verified
  login, never from the request. Every admin endpoint returns 403 to sponsors (tested route by route).

**WhatsApp**
- ✅ `WHATSAPP_MOCK_MODE=true` (no credentials in the repo). One `WhatsAppService` with `sendOTP`,
  `verifyOTP`, `sendRewardMessage`, `sendCouponMessage`, `sendEventReminder`.
- ✅ Providers ready: Meta Cloud API and MSG91 — switching is an env variable; the frontend flow doesn't change.
- ✅ OTP: 6 digits, stored hashed, 10-minute expiry, 5 attempts, 30 s resend, 5 per hour per number,
  India-only by default. Never reported as "delivered".

**Lucky Draw**
- ✅ Requires WhatsApp verification + completed Reward Machine + "I've followed all 3" (self-confirmed;
  the app never claims to check Instagram).
- ✅ One entry per participant, unique `BUB-LD-…` id, duplicate and simultaneous entries prevented.
- ✅ Admin: view entries, CSV export, secure random winner, confirm winner, change prize, redraw with reason.

**Story generator**
- ✅ Selfie (native camera) or upload → 1080×1920 image made on the phone with the BUB templates,
  vibe, reward and sponsor logo. Photos are never uploaded or stored.
- ✅ File checks: type (JPEG/PNG/WebP/HEIC, verified by file signature, not just the name) and size (15 MB).

**QR tracking**
- ✅ `/?src=H001` (and `/play?src=…`) records every visit with source_id, source_type, location,
  timestamp and session_id. Reported as "QR scans/visits", never reach. Unknown/inactive codes count as direct.
- ✅ Admin creates sources and downloads print-ready QR codes (PNG + SVG).

**Security**
- ✅ Cognito sign-in for dashboards, verified on every request; roles ADMIN / SPONSOR.
- ✅ Input validation on every endpoint; malformed JSON/ids rejected; phone numbers normalised.
- ✅ Rate limits on session, play, participant, OTP send/verify, claim, coupon, lucky draw and story endpoints,
  plus API Gateway throttling.
- ✅ Cross-site write protection (origin check) on authenticated requests.
- ✅ No secrets in the browser: the build fails if AWS/WhatsApp/session secrets or server code reach
  the client bundle (`scripts/check-client-bundle.mjs`, runs after every build).
- ✅ Demo logins are disabled in production builds.

---

## ⚙️ REQUIRES CONFIGURATION

| Area | What to do | Where |
|---|---|---|
| **AWS** | Account + region (ap-south-1), AWS CLI + SAM CLI, deploy `infra/template.yaml` | README §3 |
| **DynamoDB** | Created by the stack (PITR, encryption, deletion protection). Run `npm run seed:dynamo` (baseline only) | README §4 |
| **S3** | Created by the stack: assets bucket + CloudFront, private temp bucket (1-day expiry). Set `S3_ASSETS_BUCKET`, `ASSETS_PUBLIC_BASE_URL`, `S3_TEMP_BUCKET` | README §6 |
| **Cognito** | Created by the stack. Set `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_DOMAIN`; create admin logins with `npm run create:user` | README §5 |
| **WhatsApp provider** | Choose `meta_cloud` or `msg91`; store credentials in Secrets Manager (`bub/whatsapp`); keep `WHATSAPP_MOCK_MODE=true` until templates are approved | README §8 |
| **Secrets** | `bub/session` secret with a 64+ character `session_secret` (the app refuses to start without it) | README §3 |
| **Environment variables** | Every variable is listed in `.env.example` (a test keeps it in sync). Set them in Amplify; `NEXT_PUBLIC_*` values need a rebuild to change | README §2, §9 |
| **Amplify** | Connect the repo, set env vars, `API_PROXY_URL` = stack output `ApiUrl` | README §9 |

## 📋 REQUIRES REAL DATA

| Item | Where it goes |
|---|---|
| Sponsors (names, logos, Instagram URLs, title sponsor) | Admin → Sponsors |
| Rewards (names, descriptions, quantities, daily limits, win/redeem windows, weights) | Admin → Rewards |
| Instagram URLs + handles for BUB, Aurix, title sponsor | `NEXT_PUBLIC_INSTAGRAM_*` (currently placeholders pointing to instagram.com) |
| BUB logo, title-sponsor logo, landing hero photo | `NEXT_PUBLIC_BUB_LOGO_URL`, `NEXT_PUBLIC_TITLE_SPONSOR_LOGO_URL`, `NEXT_PUBLIC_HERO_IMAGE_URL` |
| Story templates from Media Mileage (1080×1920 background and/or transparent overlay) | Admin → Story Templates (live preview) |
| Terms & conditions page | `NEXT_PUBLIC_TERMS_URL` |
| Real QR sources (IDs, types, locations) | Admin → Sources / QR |

## 🧪 REQUIRES STAGING TEST (on a real AWS staging stack)

- [ ] **Concurrency** — run many simultaneous plays against a reward with small stock on the real
  DynamoDB table; confirm claimed + remaining = total and nothing goes negative. (Locally tested
  against the in-memory store; the DynamoDB conditions are tested by contract, not yet live.)
- [ ] **OTP** — real send/receive with the chosen provider; wrong code, expiry, resend cooldown,
  lock after 5 attempts; check MSG91 request format against its template sample if using MSG91.
- [ ] **Coupon redemption** — redeem at the "stall" from a phone, try a second redemption, try an
  expired coupon, check the sponsor dashboard updates.
- [ ] **AWS permissions** — Lambda can read/write the table and upload to `logos/*` / `templates/*` only;
  the sweeper runs every 5 minutes (check CloudWatch logs); Cognito sign-in/out round trip works.
- [ ] **File uploads** — admin logo/template upload via presigned URL, served through CloudFront, and
  the story canvas can still export with those images (CORS).
- [ ] Walk the full flow on real Android + iPhone (camera input, share sheet, download).

## 📅 REQUIRES BEFORE THE EVENT (15 October 2026)

- [ ] **WhatsApp production approval** — business verification + the 4 templates approved, then
  `WHATSAPP_MOCK_MODE=false` and a test via Admin → Overview → WhatsApp check.
- [ ] **Final sponsor data** entered and demo data absent from production (production tables are never seeded with it).
- [ ] **Final reward inventory** — quantities, daily limits and redemption windows checked by Aurix.
- [ ] **QR generation** — final sources created, codes downloaded (SVG for print), each one scanned once on a phone before printing.
- [ ] **Domain** — custom domain on Amplify; `APP_BASE_URL`, Cognito callback/logout URLs and the SAM
  `AppBaseUrl` parameter all match it exactly (QR codes encode this URL — fix it before printing).
- [ ] **SSL** — Amplify-managed certificate issued and the site loads over HTTPS only.
- [ ] **Final event information** — name, dates, venue, organiser copy in the `NEXT_PUBLIC_*` variables, then rebuild.
- [ ] `NEXT_PUBLIC_CAMPAIGN_STATUS=live`, `SEED_DEMO_DATA=false`, `ALLOW_MOCK_LOGIN=false`, `BUB_AWS_MOCK_MODE=false`.
- [ ] Admin and sponsor logins created and tested; staff briefed on redeeming at Admin → Coupons.
