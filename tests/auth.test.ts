import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatch } from "@/lib/api/dispatch";
import { signMockToken, AUTH_COOKIE } from "@/lib/auth/actor";
import { routes } from "@/lib/api/routes";
import { requireSession } from "@/lib/tracking/sessions";
import { playRewardMachine, claimReward } from "@/lib/rewards/engine";
import { setClock } from "@/lib/time";
import { makeCtx, newSession, verifySession, onlyRewards, freezeClock, DURING_EVENT, SEED_REWARD_IDS } from "./helpers";
import type { AppContext } from "@/lib/context";

function req(method: string, path: string, opts: { token?: string; body?: unknown; ip?: string } = {}) {
  const url = new URL(`http://x${path}`);
  return {
    method,
    path: url.pathname,
    query: url.searchParams,
    body: opts.body,
    headers: {},
    cookies: (opts.token ? { [AUTH_COOKIE]: opts.token } : {}) as Record<string, string>,
    ip: opts.ip ?? "10.0.0.1",
  };
}

async function claimOne(ctx: AppContext) {
  const sid = await newSession(ctx);
  await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
  await verifySession(ctx, sid);
  return (await claimReward(ctx, await requireSession(ctx, sid))).coupon!.coupon_code;
}

const adminRoutes = routes.filter((r) => r.pattern.startsWith("/api/admin"));
const sponsorRoutes = routes.filter((r) => r.pattern.startsWith("/api/sponsor"));
const concrete = (p: string) => p.replace(/:(\w+)/g, "x1");

describe("11. admin authorization", () => {
  beforeEach(() => freezeClock(DURING_EVENT));
  afterEach(() => setClock(null));

  it("every admin endpoint rejects anonymous callers with 401", async () => {
    const { ctx } = await makeCtx();
    expect(adminRoutes.length).toBeGreaterThan(15);
    for (const r of adminRoutes) {
      const res = await dispatch(req(r.method, concrete(r.pattern), { body: {} }), ctx);
      expect(res.status, `${r.method} ${r.pattern}`).toBe(401);
    }
  });

  it("every admin endpoint rejects sponsors with 403", async () => {
    const { ctx } = await makeCtx();
    const token = signMockToken(ctx, "mock-sponsor-a");
    for (const r of adminRoutes) {
      const res = await dispatch(req(r.method, concrete(r.pattern), { token, body: {} }), ctx);
      expect(res.status, `${r.method} ${r.pattern}`).toBe(403);
    }
  });

  it("rejects forged or tampered tokens", async () => {
    const { ctx } = await makeCtx();
    const good = signMockToken(ctx, "mock-admin");
    const tampered = good.replace("mock-admin", "mock-sponsor-a");
    for (const token of [tampered, "mock.mock-admin.9999999999.AAAA", "eyJhbGciOiJub25lIn0.e30."]) {
      expect((await dispatch(req("GET", "/api/admin/overview", { token }), ctx)).status).toBe(401);
    }
  });

  it("admins can read the overview and create a source", async () => {
    const { ctx } = await makeCtx();
    const token = signMockToken(ctx, "mock-admin");
    const ov = await dispatch(req("GET", "/api/admin/overview", { token }), ctx);
    expect(ov.status).toBe(200);
    expect(ov.body).toHaveProperty("stats.qr_scans");
    const created = await dispatch(req("POST", "/api/admin/sources", { token, body: { source_id: "h003", type: "HOARDING", name: "New Bus Stand", location: "Salem" } }), ctx);
    expect(created.status).toBe(201);
    expect((await ctx.repo.getSource("H003"))?.name).toBe("New Bus Stand");
    const dup = await dispatch(req("POST", "/api/admin/sources", { token, body: { source_id: "H003", type: "HOARDING", name: "x" } }), ctx);
    expect(dup.status).toBe(409);
    const bad = await dispatch(req("POST", "/api/admin/sources", { token, body: { source_id: "bad id!", type: "BILLBOARD", name: "" } }), ctx);
    expect(bad.status).toBe(400);
  });

  it("coupon redeem endpoint needs a signed-in admin", async () => {
    const { ctx } = await makeCtx();
    const code = await claimOne(ctx);
    expect((await dispatch(req("POST", `/api/coupon/${code}/redeem`), ctx)).status).toBe(401);
    expect((await dispatch(req("POST", `/api/coupon/${code}/redeem`, { token: signMockToken(ctx, "mock-sponsor-a") }), ctx)).status).toBe(403);
    const ok = await dispatch(req("POST", `/api/admin/coupons/${code}/redeem`, { token: signMockToken(ctx, "mock-admin") }), ctx);
    expect(ok.status).toBe(200);
  });
});

describe("10. sponsor data isolation", () => {
  beforeEach(() => freezeClock(DURING_EVENT));
  afterEach(() => setClock(null));

  it("anonymous and admin callers cannot use sponsor endpoints", async () => {
    const { ctx } = await makeCtx();
    for (const r of sponsorRoutes) {
      expect((await dispatch(req(r.method, r.pattern), ctx)).status).toBe(401);
      expect((await dispatch(req(r.method, r.pattern, { token: signMockToken(ctx, "mock-admin") }), ctx)).status).toBe(403);
    }
  });

  it("a sponsor sees only its own coupons and inventory, even if it asks for another sponsor_id", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER]); // Sponsor A
    const aCode = await claimOne(ctx);
    await onlyRewards(repo, [SEED_REWARD_IDS.PRODUCT]); // Sponsor B
    const bCode = await claimOne(ctx);

    const tokenA = signMockToken(ctx, "mock-sponsor-a");
    const inv = await dispatch(req("GET", "/api/sponsor/coupons?sponsor_id=spn_sample_b", { token: tokenA }), ctx);
    expect(inv.status).toBe(200);
    const body = inv.body as { totals: { total: number; claimed: number }; rewards: Array<{ reward_name: string }> };
    expect(body.rewards.map((r) => r.reward_name)).toEqual(["₹500 Voucher"]);
    expect(body.totals).toMatchObject({ total: 100, claimed: 1, remaining: 99, redeemed: 0 });

    const red = await dispatch(req("GET", "/api/sponsor/redemptions?sponsor_id=spn_sample_b", { token: tokenA }), ctx);
    const codes = (red.body as { redemptions: Array<{ coupon_code: string }> }).redemptions.map((r) => r.coupon_code);
    expect(codes).toContain(aCode);
    expect(codes).not.toContain(bCode);

    const json = JSON.stringify([inv.body, red.body]);
    expect(json).not.toMatch(/participant|phone|\+91|Test Person|Sponsor B|H001|lucky/i);
  });

  it("the Title Sponsor's inventory excludes the non-coupon fallback reward", async () => {
    const { ctx } = await makeCtx();
    const res = await dispatch(req("GET", "/api/sponsor/coupons", { token: signMockToken(ctx, "mock-sponsor-title") }), ctx);
    const body = res.body as { rewards: Array<{ reward_name: string }> };
    expect(body.rewards.map((r) => r.reward_name)).toEqual(["Special Expo Offer"]);
  });
});

describe("public API hardening", () => {
  beforeEach(() => freezeClock(DURING_EVENT));
  afterEach(() => setClock(null));

  it("rate-limits the play endpoint per IP", async () => {
    const { ctx } = await makeCtx();
    const statuses: number[] = [];
    for (let i = 0; i < 15; i++) statuses.push((await dispatch(req("POST", "/api/play", { body: { session_id: "0".repeat(32), box_index: 0 }, ip: "9.9.9.9" }), ctx)).status);
    expect(statuses.slice(0, 12).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(12).every((s) => s === 429)).toBe(true);
  });

  it("rate-limits OTP sends per IP", async () => {
    const { ctx } = await makeCtx();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await dispatch(req("POST", "/api/otp/send", { body: { session_id: "zz" }, ip: "7.7.7.7" }), ctx)).status);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });

  it("OTP: wrong codes fail and too many attempts lock the code", async () => {
    const { ctx } = await makeCtx();
    const s = await dispatch(req("POST", "/api/session", { body: {} }), ctx);
    const session_id = (s.body as { session_id: string }).session_id;
    expect((await dispatch(req("POST", "/api/participant", { body: { session_id, name: "Ravi", phone: "+91 98765 43210" } }), ctx)).status).toBe(200);
    const sent = await dispatch(req("POST", "/api/otp/send", { body: { session_id } }), ctx);
    expect(sent.body).toMatchObject({ send_status: "MOCKED", mock: true });
    for (let i = 0; i < 5; i++) expect((await dispatch(req("POST", "/api/otp/verify", { body: { session_id, code: "000000" } }), ctx)).status).toBe(400);
    const locked = await dispatch(req("POST", "/api/otp/verify", { body: { session_id, code: "123456" } }), ctx);
    expect(locked.status).toBe(429);
  });

  it("validates participant input and normalises phone numbers", async () => {
    const { ctx } = await makeCtx();
    const s = await dispatch(req("POST", "/api/session", { body: {} }), ctx);
    const session_id = (s.body as { session_id: string }).session_id;
    expect((await dispatch(req("POST", "/api/participant", { body: { session_id, name: "<b>", phone: "9876543210" } }), ctx)).status).toBe(400);
    expect((await dispatch(req("POST", "/api/participant", { body: { session_id, name: "Ravi", phone: "12345" } }), ctx)).status).toBe(400);
    const ok = await dispatch(req("POST", "/api/participant", { body: { session_id, name: "Ravi K", phone: "098765-43210" } }), ctx);
    expect(ok.status).toBe(200);
    expect((await ctx.repo.getSession(session_id))?.pending_phone).toBe("+919876543210");
  });

  it("unknown routes 404 and wrong methods 405", async () => {
    const { ctx } = await makeCtx();
    expect((await dispatch(req("GET", "/api/nope"), ctx)).status).toBe(404);
    expect((await dispatch(req("GET", "/api/play"), ctx)).status).toBe(405);
  });
});
