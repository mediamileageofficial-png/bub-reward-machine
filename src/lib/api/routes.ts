import type { AppContext } from "@/lib/context";
import { bub } from "@/config/bub";
import { notFound, badRequest } from "@/lib/errors";
import { getActor, requireActor, requireAdmin, requireSponsor, signMockToken, AUTH_COOKIE } from "@/lib/auth/actor";
import { buildLoginRedirect, exchangeCode, logoutUrl, OAUTH_COOKIE, safeNextPath } from "@/lib/auth/cognito-flow";
import { touchSession, requireSession, buildSessionState, type SessionEvent } from "@/lib/tracking/sessions";
import { playRewardMachine, claimReward, sweepExpiredHolds } from "@/lib/rewards/engine";
import { registerParticipant, sendOtp, verifyOtp, requirePhone } from "@/lib/participants";
import { getPublicCoupon, redeemCoupon, normalizeCouponCode } from "@/lib/coupons/coupons";
import { enterLuckyDraw, selectWinner, markWinner, redraw, setDrawPrize } from "@/lib/lucky-draw/lucky-draw";
import { listActiveTemplates, recordStoryGeneration } from "@/lib/story/story";
import { sponsorCouponInventory, sponsorRedemptions } from "@/lib/sponsor/sponsor";
import { createAssetUpload } from "@/lib/aws/s3";
import * as admin from "@/lib/admin/admin";
import { bodyObject, ok, created, rateLimit, type ApiRequest, type ApiResponse, type Handler } from "./http";

/**
 * THE route table. Used by:
 *  - Next.js:   src/app/api/[...path]/route.ts
 *  - AWS Lambda: infra/lambda/api.ts (behind API Gateway HTTP API)
 * Documented in docs/API.md.
 */

async function actorOf(req: ApiRequest, ctx: AppContext) {
  return getActor(ctx, req.headers, req.cookies);
}

// ---------------- public ----------------

const postSession: Handler = async (req, ctx) => {
  await rateLimit(ctx, `session:${req.ip}`, 60, 60);
  const b = bodyObject(req);
  const event = b.event === "visit" || b.event === "game_started" ? (b.event as SessionEvent) : undefined;
  const state = await touchSession(ctx, { session_id: typeof b.session_id === "string" ? b.session_id : null, src: typeof b.src === "string" ? b.src : null, event });
  return ok(state);
};

const postPlay: Handler = async (req, ctx) => {
  const b = bodyObject(req);
  await rateLimit(ctx, `play:${req.ip}`, 12, 60);
  const session = await requireSession(ctx, b.session_id);
  await rateLimit(ctx, `play-s:${session.session_id}`, 6, 60);
  const result = await playRewardMachine(ctx, session, Number(b.box_index));
  return ok({ play: result });
};

const postParticipant: Handler = async (req, ctx) => {
  const b = bodyObject(req);
  await rateLimit(ctx, `participant:${req.ip}`, 20, 60);
  const session = await requireSession(ctx, b.session_id);
  return ok(await registerParticipant(ctx, session, { name: b.name, phone: b.phone }));
};

const postOtpSend: Handler = async (req, ctx) => {
  const b = bodyObject(req);
  await rateLimit(ctx, `otp-send:${req.ip}`, 10, 600);
  const session = await requireSession(ctx, b.session_id);
  if (session.pending_phone) await rateLimit(ctx, `otp-send-p:${session.pending_phone}`, 6, 3600);
  return ok(await sendOtp(ctx, session));
};

const postOtpVerify: Handler = async (req, ctx) => {
  const b = bodyObject(req);
  await rateLimit(ctx, `otp-verify:${req.ip}`, 30, 600);
  const session = await requireSession(ctx, b.session_id);
  return ok(await verifyOtp(ctx, session, b.code));
};

const postClaim: Handler = async (req, ctx) => {
  const b = bodyObject(req);
  await rateLimit(ctx, `claim:${req.ip}`, 20, 60);
  const session = await requireSession(ctx, b.session_id);
  return ok(await claimReward(ctx, session));
};

const getCoupon: Handler = async (req, ctx) => {
  await rateLimit(ctx, `coupon:${req.ip}`, 30, 60);
  return ok({ coupon: await getPublicCoupon(ctx, req.params.code) });
};

const postCouponRedeem: Handler = async (req, ctx) => {
  const actor = requireActor(await actorOf(req, ctx));
  await rateLimit(ctx, `redeem:${actor.user_id}`, 120, 60);
  const c = await redeemCoupon(ctx, actor, req.params.code);
  return ok({ coupon: { coupon_code: c.coupon_code, status: c.status, redeemed_at: c.redeemed_at } });
};

const postLuckyDraw: Handler = async (req, ctx) => {
  const b = bodyObject(req);
  await rateLimit(ctx, `lucky:${req.ip}`, 10, 60);
  const session = await requireSession(ctx, b.session_id);
  return ok(
    await enterLuckyDraw(ctx, session, {
      followed_bub: b.followed_bub === true,
      followed_organizer: b.followed_organizer === true,
      followed_sponsor: b.followed_sponsor === true,
    }),
  );
};

const getStoryTemplates: Handler = async (_req, ctx) => ok({ templates: await listActiveTemplates(ctx) }, { headers: { "Cache-Control": "public, max-age=60" } });

const postStoryGenerate: Handler = async (req, ctx) => {
  const b = bodyObject(req);
  await rateLimit(ctx, `story:${req.ip}`, 20, 60);
  const session = await requireSession(ctx, b.session_id);
  return ok(await recordStoryGeneration(ctx, session, { template_id: b.template_id, vibe: b.vibe }));
};

const getSessionState: Handler = async (req, ctx) => {
  await rateLimit(ctx, `session:${req.ip}`, 60, 60);
  const session = await requireSession(ctx, req.query.get("session_id"));
  return ok(await buildSessionState(ctx, session));
};

// ---------------- auth ----------------

const getMe: Handler = async (req, ctx) => {
  const actor = await actorOf(req, ctx);
  if (!actor) return ok({ user: null, mock: ctx.cfg.awsMockMode });
  const sponsor = actor.sponsor_id ? await ctx.repo.getSponsor(actor.sponsor_id) : null;
  return ok({ user: { email: actor.email, role: actor.role, sponsor_id: actor.sponsor_id, sponsor_name: sponsor?.name ?? null }, mock: ctx.cfg.awsMockMode });
};

const getMockUsers: Handler = async (_req, ctx) => {
  if (!ctx.cfg.allowMockLogin) throw notFound("NOT_FOUND", "Not found");
  const users = await ctx.repo.listDashboardUsers();
  return ok({ users: users.map((u) => ({ user_id: u.user_id, email: u.email, role: u.role })).sort((a, b) => a.role.localeCompare(b.role) || a.email.localeCompare(b.email)) });
};

const postMockLogin: Handler = async (req, ctx) => {
  if (!ctx.cfg.allowMockLogin) throw notFound("NOT_FOUND", "Not found");
  const b = bodyObject(req);
  const user = typeof b.user_id === "string" ? await ctx.repo.getDashboardUser(b.user_id) : null;
  if (!user) throw badRequest("UNKNOWN_USER", "Unknown mock user");
  return ok({ user: { email: user.email, role: user.role } }, { cookies: [{ name: AUTH_COOKIE, value: signMockToken(ctx, user.user_id), maxAge: 12 * 3600 }] });
};

const getLogin: Handler = async (req, ctx) => {
  const next = safeNextPath(req.query.get("next"));
  if (ctx.cfg.awsMockMode) return { status: 302, redirect: `/login?next=${encodeURIComponent(next)}` };
  const { url, cookieValue } = buildLoginRedirect(ctx, next);
  return { status: 302, redirect: url, cookies: [{ name: OAUTH_COOKIE, value: cookieValue, maxAge: 600 }] };
};

const getCallback: Handler = async (req, ctx) => {
  const code = req.query.get("code");
  if (!code) throw badRequest("OAUTH_CODE", "Missing code");
  const { idToken, expiresIn, next } = await exchangeCode(ctx, code, req.cookies[OAUTH_COOKIE], req.query.get("state"));
  return {
    status: 302,
    redirect: next,
    cookies: [
      { name: AUTH_COOKIE, value: idToken, maxAge: expiresIn },
      { name: OAUTH_COOKIE, value: "", maxAge: 0 },
    ],
  };
};

const logout: Handler = async (_req, ctx) => {
  const cookies = [{ name: AUTH_COOKIE, value: "", maxAge: 0 }];
  const url = ctx.cfg.awsMockMode ? "/login" : logoutUrl(ctx) ?? "/";
  return { status: 302, redirect: url, cookies };
};

// ---------------- admin ----------------

const adminOnly =
  (fn: (req: ApiRequest, ctx: AppContext) => Promise<ApiResponse>): Handler =>
  async (req, ctx) => {
    const actor = requireAdmin(await actorOf(req, ctx));
    await rateLimit(ctx, `admin:${actor.user_id}`, 300, 60);
    return fn(req, ctx);
  };

const sponsorOnly =
  (fn: (req: ApiRequest, ctx: AppContext, sponsorId: string) => Promise<ApiResponse>): Handler =>
  async (req, ctx) => {
    const actor = requireSponsor(await actorOf(req, ctx));
    await rateLimit(ctx, `sponsor:${actor.user_id}`, 120, 60);
    // sponsor_id comes from the verified identity only. Any sponsor_id in the request is ignored.
    return fn(req, ctx, actor.sponsor_id);
  };

const adminRedeem: Handler = async (req, ctx) => {
  const actor = requireAdmin(await actorOf(req, ctx));
  let code: string;
  try {
    code = normalizeCouponCode(req.params.id);
  } catch {
    const found = (await ctx.repo.listCoupons()).find((c) => c.coupon_id === req.params.id);
    if (!found) throw notFound("COUPON_NOT_FOUND", "Coupon not found.");
    code = found.coupon_code;
  }
  const c = await redeemCoupon(ctx, actor, code);
  return ok({ coupon: { coupon_code: c.coupon_code, status: c.status, redeemed_at: c.redeemed_at } });
};

const adminLuckyDraw: Handler = async (req, ctx) => {
  requireAdmin(await actorOf(req, ctx));
  if (req.query.get("format") === "csv") {
    return { status: 200, text: await admin.luckyDrawCsv(ctx), contentType: "text/csv; charset=utf-8", headers: { "Content-Disposition": `attachment; filename="bub-lucky-draw-entries.csv"`, "Cache-Control": "no-store" } };
  }
  return ok(await admin.luckyDrawAdmin(ctx));
};

const adminSelectWinner: Handler = async (req, ctx) => {
  const actor = requireAdmin(await actorOf(req, ctx));
  return created({ draw: await selectWinner(ctx, actor, bodyObject(req).prize) });
};

const adminDrawAction: Handler = async (req, ctx) => {
  const actor = requireAdmin(await actorOf(req, ctx));
  const b = bodyObject(req);
  const id = req.params.id;
  switch (b.action) {
    case "confirm":
      return ok({ draw: await markWinner(ctx, id) });
    case "set_prize":
      return ok({ draw: await setDrawPrize(ctx, id, b.prize) });
    case "redraw":
      return ok({ draw: await redraw(ctx, actor, id, b.reason) });
    default:
      throw badRequest("INVALID_ACTION", "action must be confirm, set_prize or redraw");
  }
};

// ---------------- table ----------------

interface Route {
  method: "GET" | "POST" | "PATCH";
  pattern: string;
  handler: Handler;
}

export const routes: Route[] = [
  // public
  { method: "POST", pattern: "/api/session", handler: postSession },
  { method: "GET", pattern: "/api/session", handler: getSessionState },
  { method: "POST", pattern: "/api/play", handler: postPlay },
  { method: "POST", pattern: "/api/participant", handler: postParticipant },
  { method: "POST", pattern: "/api/otp/send", handler: postOtpSend },
  { method: "POST", pattern: "/api/otp/verify", handler: postOtpVerify },
  { method: "POST", pattern: "/api/reward/claim", handler: postClaim },
  { method: "GET", pattern: "/api/coupon/:code", handler: getCoupon },
  { method: "POST", pattern: "/api/coupon/:code/redeem", handler: postCouponRedeem },
  { method: "POST", pattern: "/api/lucky-draw/enter", handler: postLuckyDraw },
  { method: "GET", pattern: "/api/story/templates", handler: getStoryTemplates },
  { method: "POST", pattern: "/api/story/generate", handler: postStoryGenerate },

  // auth
  { method: "GET", pattern: "/api/auth/me", handler: getMe },
  { method: "GET", pattern: "/api/auth/mock-users", handler: getMockUsers },
  { method: "POST", pattern: "/api/auth/mock-login", handler: postMockLogin },
  { method: "GET", pattern: "/api/auth/login", handler: getLogin },
  { method: "GET", pattern: "/api/auth/callback", handler: getCallback },
  { method: "GET", pattern: "/api/auth/logout", handler: logout },
  { method: "POST", pattern: "/api/auth/logout", handler: logout },

  // admin
  { method: "GET", pattern: "/api/admin/overview", handler: adminOnly(async (_r, ctx) => ok(await admin.adminOverview(ctx))) },
  { method: "GET", pattern: "/api/admin/sources", handler: adminOnly(async (_r, ctx) => ok({ sources: await admin.listSourcesAdmin(ctx) })) },
  { method: "POST", pattern: "/api/admin/sources", handler: adminOnly(async (r, ctx) => created({ source: await admin.createSource(ctx, r.body) })) },
  {
    method: "GET",
    pattern: "/api/admin/sources/:id/visits",
    handler: adminOnly(async (r, ctx) => ok({ visits: await ctx.repo.listSourceVisits(r.params.id.toUpperCase(), Math.min(500, Number(r.query.get("limit")) || 100)) })),
  },
  { method: "PATCH", pattern: "/api/admin/sources/:id", handler: adminOnly(async (r, ctx) => ok({ source: await admin.updateSource(ctx, r.params.id, r.body) })) },
  { method: "GET", pattern: "/api/admin/sponsors", handler: adminOnly(async (_r, ctx) => ok({ sponsors: await ctx.repo.listSponsors() })) },
  { method: "POST", pattern: "/api/admin/sponsors", handler: adminOnly(async (r, ctx) => created({ sponsor: await admin.createSponsor(ctx, r.body) })) },
  { method: "PATCH", pattern: "/api/admin/sponsors/:id", handler: adminOnly(async (r, ctx) => ok({ sponsor: await admin.updateSponsor(ctx, r.params.id, r.body) })) },
  { method: "GET", pattern: "/api/admin/rewards", handler: adminOnly(async (_r, ctx) => ok({ rewards: await admin.listRewardsAdmin(ctx) })) },
  { method: "POST", pattern: "/api/admin/rewards", handler: adminOnly(async (r, ctx) => created({ reward: await admin.createReward(ctx, r.body) })) },
  { method: "PATCH", pattern: "/api/admin/rewards/:id", handler: adminOnly(async (r, ctx) => ok({ reward: await admin.updateReward(ctx, r.params.id, r.body) })) },
  { method: "GET", pattern: "/api/admin/coupons", handler: adminOnly(async (r, ctx) => ok({ coupons: await admin.searchCoupons(ctx, r.query) })) },
  { method: "POST", pattern: "/api/admin/coupons/:id/redeem", handler: adminRedeem },
  { method: "GET", pattern: "/api/admin/participants", handler: adminOnly(async (r, ctx) => ok({ participants: await admin.searchParticipants(ctx, r.query) })) },
  { method: "GET", pattern: "/api/admin/lucky-draw", handler: adminLuckyDraw },
  { method: "POST", pattern: "/api/admin/lucky-draw/select-winner", handler: adminSelectWinner },
  { method: "POST", pattern: "/api/admin/lucky-draw/draws/:id", handler: adminDrawAction },
  { method: "GET", pattern: "/api/admin/story-templates", handler: adminOnly(async (_r, ctx) => ok({ templates: await ctx.repo.listStoryTemplates() })) },
  { method: "POST", pattern: "/api/admin/story-templates", handler: adminOnly(async (r, ctx) => created({ template: await admin.upsertTemplate(ctx, r.body) })) },
  { method: "PATCH", pattern: "/api/admin/story-templates/:id", handler: adminOnly(async (r, ctx) => ok({ template: await admin.upsertTemplate(ctx, r.body, r.params.id) })) },
  { method: "POST", pattern: "/api/admin/uploads", handler: adminOnly(async (r, ctx) => ok(await createAssetUpload(ctx, bodyObject(r)))) },
  { method: "POST", pattern: "/api/admin/maintenance/sweep-holds", handler: adminOnly(async (_r, ctx) => ok({ released: await sweepExpiredHolds(ctx, 500) })) },
  {
    method: "POST",
    pattern: "/api/admin/whatsapp/test",
    handler: adminOnly(async (r, ctx) => {
      const phone = requirePhone(ctx, bodyObject(r).phone);
      const res = await ctx.whatsapp.sendEventReminder(phone, { name: `${bub.event.shortName} team`, eventName: bub.event.name, dates: bub.event.datesLabel, venue: bub.event.venue });
      return ok({ status: res.status, provider: res.provider, error: res.error ?? null });
    }),
  },

  // sponsor (own sponsor_id only)
  { method: "GET", pattern: "/api/sponsor/coupons", handler: sponsorOnly(async (_r, ctx, sid) => ok(await sponsorCouponInventory(ctx, sid))) },
  { method: "GET", pattern: "/api/sponsor/redemptions", handler: sponsorOnly(async (_r, ctx, sid) => ok({ redemptions: await sponsorRedemptions(ctx, sid) })) },
];

export function matchRoute(method: string, path: string): { route: Route; params: Record<string, string> } | { methodNotAllowed: true } | null {
  const segs = path.replace(/\/+$/, "").split("/");
  let pathMatched = false;
  for (const route of routes) {
    const pSegs = route.pattern.split("/");
    if (pSegs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let match = true;
    for (let i = 0; i < pSegs.length; i++) {
      if (pSegs[i].startsWith(":")) {
        if (!segs[i]) {
          match = false;
          break;
        }
        try {
          params[pSegs[i].slice(1)] = decodeURIComponent(segs[i]);
        } catch {
          match = false;
          break;
        }
      } else if (pSegs[i] !== segs[i]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    pathMatched = true;
    if (route.method === method) return { route, params };
  }
  return pathMatched ? { methodNotAllowed: true } : null;
}

