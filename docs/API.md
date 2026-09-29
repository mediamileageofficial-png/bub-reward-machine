# BUB Reward Machine — API reference

All endpoints live under `/api`, return JSON, and are served by one shared route table
(`src/lib/api/routes.ts`) — by Next.js locally and by Lambda behind API Gateway in production.

Errors always look like:

```json
{ "error": { "code": "ALREADY_PLAYED", "message": "This WhatsApp number has already played…", "details": {} } }
```

`429` responses carry `Retry-After`. Timestamps are UTC ISO-8601.

The public flow is authenticated by a random 128-bit `session_id` (created by `POST /api/session`,
kept in the browser's localStorage). Dashboards use a Cognito ID token in an httpOnly cookie
(`bub_auth`) or an `Authorization: Bearer` header.

---

## Public

| Method | Path | Rate limit | Purpose |
|---|---|---|---|
| POST | `/api/session` | 60/min/IP | Create or resume a session; record a QR visit or game start |
| GET | `/api/session?session_id=` | 60/min/IP | Resumable state of the flow |
| POST | `/api/play` | 12/min/IP, 6/min/session | Open a box (server picks and holds the reward) |
| POST | `/api/participant` | 20/min/IP | Name + WhatsApp number (unverified) |
| POST | `/api/otp/send` | 10/10 min/IP, 6/h/number (+ service limits) | Send WhatsApp OTP |
| POST | `/api/otp/verify` | 30/10 min/IP, 5 attempts/code | Verify OTP; links the session to one participant per number |
| POST | `/api/reward/claim` | 20/min/IP | Claim the held reward (verified sessions only) |
| GET | `/api/coupon/:code` | 30/min/IP | Coupon status (no personal data) |
| POST | `/api/coupon/:code/redeem` | authenticated | Redeem (ADMIN; SPONSOR only if `SPONSOR_SELF_REDEMPTION=true` and own coupon) |
| POST | `/api/lucky-draw/enter` | 10/min/IP | Enter the Lucky Draw |
| GET | `/api/story/templates` | cached 60s | Active story templates |
| POST | `/api/story/generate` | 20/min/IP | Record a generated story (the image itself never leaves the device) |

### POST /api/session
```json
// request
{ "session_id": "optional, from localStorage", "src": "H001", "event": "visit" | "game_started" }
// response
{
  "session_id": "3f9c…(32 hex)",
  "source": { "source_id": "H001", "type": "HOARDING", "name": "Salem Junction" } | null,
  "play": PublicPlay | null,
  "verified": false,
  "participant": { "first_name": "Priya", "phone_masked": "+91 98•••••345", "coupon_code": "BUB-SUEEX6", "reward_claimed": true, "lucky_draw_entry_id": "BUB-LD-977078" } | null,
  "mock_mode": { "whatsapp": true, "aws": true }
}
```
Unknown, malformed or inactive `src` values are treated as direct traffic. `event: "visit"` with a
valid source increments **QR scans** (visits through a QR link — not physical reach).

### POST /api/play
```json
{ "session_id": "…", "box_index": 0 }          // 0, 1 or 2
→ { "play": {
      "play_id": "ply_…", "box_index": 1,
      "outcome": "REWARD" | "ENTRY" | "NONE",
      "status": "PENDING_VERIFICATION" | "CLAIMED" | "EXPIRED",
      "reward": { "name": "₹500 Voucher", "description": "…", "type": "VOUCHER", "sponsor_name": "…", "sponsor_logo_url": null, "issues_coupon": true } | null,
      "hold_expires_at": "2026-10-15T06:20:00.000Z" | null } }
```
Idempotent per session (a second call returns the same play). The reward is chosen on the server
and one unit is **held** atomically for `REWARD_HOLD_MINUTES`. Probabilities, weights, inventory
and the coupon code are never returned. `409 ALREADY_PLAYED` if the session is already verified
with a number that has claimed.

### POST /api/participant
```json
{ "session_id": "…", "name": "Priya", "phone": "98765 43210" } → { "phone_masked": "+91 98•••••210", "name": "Priya" }
```
Numbers are normalised to E.164 (`+919876543210`); only mobile numbers are accepted.

### POST /api/otp/send
```json
{ "session_id": "…" }
→ { "phone_masked": "…", "send_status": "MOCKED" | "ACCEPTED", "mock": true, "mock_hint": "Demo mode: …123456.",
    "resend_after_seconds": 30, "expires_in_seconds": 600 }
```
`ACCEPTED` means the provider accepted the message for delivery — never that it was delivered.
`502 WHATSAPP_SEND_FAILED` if the provider rejects it.

### POST /api/otp/verify
```json
{ "session_id": "…", "code": "123456" }
→ { "verified": true, "first_name": "Priya", "already_played": false, "existing_coupon_code": null }
```
`400 WRONG_CODE`, `429 OTP_LOCKED` after `OTP_MAX_ATTEMPTS`.

### POST /api/reward/claim
```json
{ "session_id": "…" }
→ { "play": PublicPlay,
    "coupon": { "coupon_code": "BUB-8F4K2Q", "status": "CLAIMED", "valid_from": "…", "valid_until": "…" } | null,
    "reward_changed": false,
    "whatsapp": { "status": "MOCKED" | "ACCEPTED" | "FAILED" | "SKIPPED" } }
```
Requires a verified session (`403 VERIFICATION_REQUIRED`). One claim per number: a number that has
already claimed gets its original reward back, never a second one. If the hold expired, a fresh
reward is allocated (`reward_changed: true`).

### GET /api/coupon/:code
```json
→ { "coupon": { "coupon_code": "BUB-8F4K2Q", "status": "CLAIMED" | "REDEEMED" | "EXPIRED", "reward_name": "…",
    "reward_description": "…", "sponsor_name": "…", "sponsor_logo_url": null, "valid_from": "…", "valid_until": "…", "redeemed_at": null } }
```
Held-but-unclaimed codes return 404.

### POST /api/coupon/:code/redeem  *(authenticated)*
`→ { "coupon": { "coupon_code", "status": "REDEEMED", "redeemed_at" } }`
Errors: `409 ALREADY_REDEEMED`, `409 COUPON_EXPIRED`, `409 COUPON_NOT_YET_VALID`, `403`.

### POST /api/lucky-draw/enter
```json
{ "session_id": "…", "followed_bub": true, "followed_organizer": true, "followed_sponsor": true }
→ { "entry_id": "BUB-LD-482917", "entered_at": "…", "already_entered": false }
```
Requires a verified session whose number has completed the Reward Machine. Follows are
**self-confirmed** — they are stored, not verified with Instagram. Repeat calls return the same entry.

### GET /api/story/templates
`→ { "templates": [{ "template_id", "name", "vibe", "active", "sort_order", "background_asset_url", "overlay_asset_url", "photo_frame": {x,y,w,h}, "accent_color", "text_color", "supported_fields": [...] }] }`

### POST /api/story/generate
`{ "session_id", "template_id", "vibe": "SHOPPER" | "EXPLORER" | "DEAL_HUNTER" | "EXPERIENCE_SEEKER" } → { "generation_id" }`

---

## Auth

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/login?next=/admin` | Redirect to Cognito Hosted UI (PKCE). Mock mode → `/login` |
| GET | `/api/auth/callback` | OAuth code exchange; sets `bub_auth` (httpOnly) |
| GET/POST | `/api/auth/logout` | Clears the cookie; Cognito logout |
| GET | `/api/auth/me` | `{ user: { email, role, sponsor_id, sponsor_name } \| null, mock }` |
| GET | `/api/auth/mock-users` | Mock mode only |
| POST | `/api/auth/mock-login` | Mock mode only: `{ user_id }` |

Roles come from Cognito groups `ADMIN` / `SPONSOR`. A sponsor's `sponsor_id` comes only from the
server-side user mapping (`USER#<sub>`) or the admin-set `custom:sponsor_id` attribute.

---

## Admin *(role ADMIN — 401 anonymous, 403 other roles)*

| Method | Path | Body / query |
|---|---|---|
| GET | `/api/admin/overview` | metrics, per-source table, inventory |
| GET | `/api/admin/sources` | includes `qr_url` per source |
| POST | `/api/admin/sources` | `{ source_id, type: HOARDING\|NEWSPAPER\|NOTICE\|SOCIAL\|OTHER, name, location, active }` |
| PATCH | `/api/admin/sources/:id` | any of `type, name, location, active` |
| GET | `/api/admin/sponsors` | |
| POST | `/api/admin/sponsors` | `{ name, logo_url, instagram_url, is_title_sponsor, active }` |
| PATCH | `/api/admin/sponsors/:id` | partial |
| GET | `/api/admin/rewards` | adds `sponsor_name`, `held`, `sold_out` |
| POST | `/api/admin/rewards` | `{ sponsor_id, name, description, type, total_limit, daily_limit, active, valid_from, valid_until, redeem_from, redeem_until, fallback, weight }` |
| PATCH | `/api/admin/rewards/:id` | partial; `total_limit` changes adjust remaining stock atomically (`409 INVENTORY_BELOW_ZERO`) |
| GET | `/api/admin/coupons` | `?code=&participant=&sponsor_id=&status=` |
| POST | `/api/admin/coupons/:id/redeem` | `:id` = coupon code or coupon_id |
| GET | `/api/admin/participants` | `?name=&whatsapp=&source=&reward_id=&from=&to=` (numbers masked) |
| GET | `/api/admin/lucky-draw` | totals, entries, draws; `?format=csv` exports entries |
| POST | `/api/admin/lucky-draw/select-winner` | `{ prize }` — crypto-random over eligible, not-yet-drawn entries |
| POST | `/api/admin/lucky-draw/draws/:id` | `{ action: "confirm" }` · `{ action: "set_prize", prize }` · `{ action: "redraw", reason }` |
| GET | `/api/admin/story-templates` | |
| POST | `/api/admin/story-templates` | template fields (see types) |
| PATCH | `/api/admin/story-templates/:id` | full template |
| POST | `/api/admin/uploads` | `{ content_type, kind: "logo"\|"template" }` → presigned S3 PUT (or inline in mock mode) |
| POST | `/api/admin/maintenance/sweep-holds` | release expired holds now |
| POST | `/api/admin/whatsapp/test` | `{ phone }` — sends the reminder template |

## Sponsor *(role SPONSOR — scoped to the caller's own sponsor_id)*

| Method | Path | Response |
|---|---|---|
| GET | `/api/sponsor/coupons` | `{ totals: { total, claimed, remaining, redeemed }, rewards: [...] }` |
| GET | `/api/sponsor/redemptions` | `{ redemptions: [{ coupon_code, status, redeemed_at }] }` |

Any `sponsor_id` in the request is ignored. Responses never include participants, other sponsors,
sources, campaign totals or Lucky Draw data.
