import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireSession, touchSession } from "@/lib/tracking/sessions";
import { registerParticipant, sendOtp, verifyOtp } from "@/lib/participants";
import { playRewardMachine, claimReward } from "@/lib/rewards/engine";
import { redeemCoupon, getPublicCoupon } from "@/lib/coupons/coupons";
import { enterLuckyDraw } from "@/lib/lucky-draw/lucky-draw";
import { recordStoryGeneration } from "@/lib/story/story";
import { dispatch } from "@/lib/api/dispatch";
import { signMockToken, AUTH_COOKIE, type Actor } from "@/lib/auth/actor";
import { COUPON_CODE_PATTERN } from "@/lib/ids";
import { setClock } from "@/lib/time";
import { makeCtx, newSession, verifySession, onlyRewards, setReward, freezeClock, nextPhone, DURING_EVENT, SEED_REWARD_IDS } from "./helpers";

/**
 * PRODUCTION-READINESS SCENARIOS 1–16 (the list in the staging brief), end to end through the
 * same services the API uses. Deeper edge cases live in the other suites.
 */

const ADMIN: Actor = { user_id: "mock-admin", email: "admin@bub.local", role: "ADMIN", sponsor_id: null };
const ALL_FOLLOWS = { followed_bub: true, followed_organizer: true, followed_sponsor: true };

function req(method: string, path: string, opts: { token?: string; body?: unknown; ip?: string; origin?: string; host?: string } = {}) {
  const url = new URL(`http://x${path}`);
  const headers: Record<string, string> = {};
  if (opts.origin) headers.origin = opts.origin;
  if (opts.host) headers.host = opts.host;
  return { method, path: url.pathname, query: url.searchParams, body: opts.body, headers, cookies: (opts.token ? { [AUTH_COOKIE]: opts.token } : {}) as Record<string, string>, ip: opts.ip ?? "10.9.9.9" };
}

describe("production readiness — 16 scenarios", () => {
  beforeEach(() => freezeClock(DURING_EVENT));
  afterEach(() => setClock(null));

  it("1. new participant: name + number registered, participant created only after verification", async () => {
    const { ctx, repo } = await makeCtx();
    const sid = await newSession(ctx, "H001");
    const r = await registerParticipant(ctx, await requireSession(ctx, sid), { name: "  Priya   K ", phone: "098765 43210" });
    expect(r).toEqual({ phone_masked: "+91 98•••••210", name: "Priya K" });
    expect(repo.participants.size).toBe(0); // nothing stored as a participant until OTP verification
    await sendOtp(ctx, await requireSession(ctx, sid));
    await verifyOtp(ctx, await requireSession(ctx, sid), "123456");
    const [p] = [...repo.participants.values()];
    expect(p).toMatchObject({ name: "Priya K", phone: "+919876543210", source_id: "H001", whatsapp_verified: true, session_id: sid });
    expect(Object.keys(p)).not.toContain("email");
  });

  it("2. OTP send: goes through WhatsAppService, stored hashed, never reported as delivered", async () => {
    const { ctx, repo, outbox } = await makeCtx();
    const sid = await newSession(ctx);
    await registerParticipant(ctx, await requireSession(ctx, sid), { name: "Ravi", phone: "9876500011" });
    const r = await sendOtp(ctx, await requireSession(ctx, sid));
    expect(r.send_status).toBe("MOCKED");
    expect(JSON.stringify(r)).not.toMatch(/deliver/i);
    expect(outbox.outbox.at(-1)).toMatchObject({ to: "+919876500011", template: ctx.cfg.whatsapp.templates.otp, bodyParams: ["123456"] });
    const stored = await repo.getOtp("+919876500011");
    expect(stored?.code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain("123456");
    // Non-allowed countries are refused before any message is sent (cost/abuse control).
    await expect(registerParticipant(ctx, await requireSession(ctx, sid), { name: "Ravi", phone: "+44 7911 123456" })).rejects.toMatchObject({ code: "PHONE_COUNTRY_NOT_SUPPORTED" });
  });

  it("3. OTP verification: wrong code rejected, right code verifies, code is single-use", async () => {
    const { ctx, repo } = await makeCtx();
    const sid = await newSession(ctx);
    await registerParticipant(ctx, await requireSession(ctx, sid), { name: "Meena", phone: "9876500012" });
    await sendOtp(ctx, await requireSession(ctx, sid));
    await expect(verifyOtp(ctx, await requireSession(ctx, sid), "111111")).rejects.toMatchObject({ code: "WRONG_CODE" });
    await expect(verifyOtp(ctx, await requireSession(ctx, sid), "12345")).rejects.toMatchObject({ code: "INVALID_CODE" });
    const ok = await verifyOtp(ctx, await requireSession(ctx, sid), "123456");
    expect(ok.verified).toBe(true);
    expect((await repo.getSession(sid))?.verified_phone).toBe("+919876500012");
    await expect(verifyOtp(ctx, await requireSession(ctx, sid), "123456")).rejects.toMatchObject({ code: "WRONG_CODE" });
  });

  it("4. successful play: server picks and holds a reward, claim reveals a unique coupon", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER]);
    const sid = await newSession(ctx, "N001");
    const play = await playRewardMachine(ctx, await requireSession(ctx, sid), 2);
    expect(play).toMatchObject({ outcome: "REWARD", status: "PENDING_VERIFICATION", box_index: 2 });
    await verifySession(ctx, sid);
    const claim = await claimReward(ctx, await requireSession(ctx, sid));
    expect(claim.play.status).toBe("CLAIMED");
    expect(claim.coupon?.coupon_code).toMatch(COUPON_CODE_PATTERN);
    expect((await repo.getStats()).rewards_won).toBe(1);
  });

  it("5. duplicate play: same session, refresh, new session/device with the same number", async () => {
    const { ctx, repo } = await makeCtx();
    const phone = nextPhone();
    const sid = await newSession(ctx);
    const a = await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
    const b = await playRewardMachine(ctx, await requireSession(ctx, sid), 1); // double tap / refresh
    expect(b.play_id).toBe(a.play_id);
    await verifySession(ctx, sid, phone);
    const first = await claimReward(ctx, await requireSession(ctx, sid));
    // "New device": fresh session, same number — verified but can't play, and a claim returns the original.
    const other = await newSession(ctx);
    const v = await verifySession(ctx, other, phone);
    expect(v.already_played).toBe(true);
    await expect(playRewardMachine(ctx, await requireSession(ctx, other), 0)).rejects.toMatchObject({ code: "ALREADY_PLAYED" });
    expect((await claimReward(ctx, await requireSession(ctx, other))).coupon?.coupon_code).toBe(first.coupon?.coupon_code);
    expect((await repo.getStats()).rewards_won).toBe(1);
  });

  it("6. concurrent play: 40 simultaneous players on 3 units → exactly 3 winners, never negative", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER, SEED_REWARD_IDS.FALLBACK]);
    await setReward(repo, SEED_REWARD_IDS.VOUCHER, { total_limit: 3, remaining_inventory: 3, daily_limit: null });
    const sessions = await Promise.all(Array.from({ length: 40 }, () => newSession(ctx)));
    const plays = await Promise.all(sessions.map(async (s) => playRewardMachine(ctx, await requireSession(ctx, s), 0)));
    expect(plays.filter((p) => p.outcome === "REWARD")).toHaveLength(3);
    expect((await repo.getReward(SEED_REWARD_IDS.VOUCHER))!.remaining_inventory).toBe(0);
  });

  it("7. inventory exhaustion: sold-out reward is never issued; fallback takes over", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER, SEED_REWARD_IDS.FALLBACK]);
    await setReward(repo, SEED_REWARD_IDS.VOUCHER, { total_limit: 1, remaining_inventory: 1 });
    const outcomes = [];
    for (let i = 0; i < 4; i++) outcomes.push((await playRewardMachine(ctx, await requireSession(ctx, await newSession(ctx)), 0)).outcome);
    expect(outcomes).toEqual(["REWARD", "ENTRY", "ENTRY", "ENTRY"]);
    expect((await repo.getReward(SEED_REWARD_IDS.VOUCHER))!.remaining_inventory).toBe(0);
  });

  it("8. coupon generation: unique codes tied to the right sponsor and reward, ISSUED → CLAIMED", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.PRODUCT]);
    const sid = await newSession(ctx);
    await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
    const held = [...repo.coupons.values()][0];
    expect(held).toMatchObject({ status: "ISSUED", sponsor_id: "spn_sample_b", reward_id: SEED_REWARD_IDS.PRODUCT, participant_id: null });
    await verifySession(ctx, sid);
    await claimReward(ctx, await requireSession(ctx, sid));
    const claimed = (await repo.getCoupon(held.coupon_code))!;
    expect(claimed.status).toBe("CLAIMED");
    expect(claimed.participant_id).toBe((await repo.getSession(sid))!.participant_id);
  });

  it("9. coupon redemption during the event window", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER]);
    const sid = await newSession(ctx);
    await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
    await verifySession(ctx, sid);
    const code = (await claimReward(ctx, await requireSession(ctx, sid))).coupon!.coupon_code;
    const r = await redeemCoupon(ctx, ADMIN, code);
    expect(r.status).toBe("REDEEMED");
    expect((await getPublicCoupon(ctx, code)).status).toBe("REDEEMED");
    expect((await repo.getReward(SEED_REWARD_IDS.VOUCHER))!.redeemed_count).toBe(1);
  });

  it("10. duplicate redemption: second (and concurrent) attempts are refused", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER]);
    const sid = await newSession(ctx);
    await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
    await verifySession(ctx, sid);
    const code = (await claimReward(ctx, await requireSession(ctx, sid))).coupon!.coupon_code;
    const results = await Promise.allSettled([redeemCoupon(ctx, ADMIN, code), redeemCoupon(ctx, ADMIN, code), redeemCoupon(ctx, ADMIN, code)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(redeemCoupon(ctx, ADMIN, code)).rejects.toMatchObject({ code: "ALREADY_REDEEMED" });
    expect((await repo.getReward(SEED_REWARD_IDS.VOUCHER))!.redeemed_count).toBe(1);
  });

  it("11. Lucky Draw entry: verified + played + 3 self-confirmed follows → unique BUB-LD id", async () => {
    const { ctx, repo } = await makeCtx();
    const sid = await newSession(ctx);
    await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
    await verifySession(ctx, sid);
    await expect(enterLuckyDraw(ctx, await requireSession(ctx, sid), ALL_FOLLOWS)).rejects.toMatchObject({ code: "PLAY_FIRST" }); // not claimed yet
    await claimReward(ctx, await requireSession(ctx, sid));
    await expect(enterLuckyDraw(ctx, await requireSession(ctx, sid), { ...ALL_FOLLOWS, followed_sponsor: false })).rejects.toMatchObject({ code: "FOLLOW_CONFIRMATION_REQUIRED" });
    const e = await enterLuckyDraw(ctx, await requireSession(ctx, sid), ALL_FOLLOWS);
    expect(e.entry_id).toMatch(/^BUB-LD-\d{6}$/);
    expect(repo.entries.size).toBe(1);
  });

  it("12. duplicate Lucky Draw entry: repeats and concurrent calls yield one entry", async () => {
    const { ctx, repo } = await makeCtx();
    const sid = await newSession(ctx);
    await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
    await verifySession(ctx, sid);
    await claimReward(ctx, await requireSession(ctx, sid));
    const all = await Promise.all(Array.from({ length: 6 }, async () => enterLuckyDraw(ctx, await requireSession(ctx, sid), ALL_FOLLOWS)));
    expect(new Set(all.map((a) => a.entry_id)).size).toBe(1);
    expect(repo.entries.size).toBe(1);
  });

  it("13. sponsor isolation: own coupons only; other sponsors, participants, analytics and admin are off-limits", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.PRODUCT]); // sponsor B's coupon exists
    const sid = await newSession(ctx);
    await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
    await verifySession(ctx, sid);
    const bCode = (await claimReward(ctx, await requireSession(ctx, sid))).coupon!.coupon_code;
    const tokenA = signMockToken(ctx, "mock-sponsor-a");
    const red = await dispatch(req("GET", "/api/sponsor/redemptions?sponsor_id=spn_sample_b", { token: tokenA }), ctx);
    expect(JSON.stringify(red.body)).not.toContain(bCode);
    for (const path of ["/api/admin/overview", "/api/admin/participants", "/api/admin/sponsors", "/api/admin/rewards", "/api/admin/coupons", "/api/admin/lucky-draw", "/api/admin/sources"]) {
      expect((await dispatch(req("GET", path, { token: tokenA }), ctx)).status, path).toBe(403);
    }
    expect((await dispatch(req("POST", `/api/coupon/${bCode}/redeem`, { token: tokenA }), ctx)).status).toBe(403);
  });

  it("14. admin authorization: anonymous 401, sponsor 403, admin 200; cross-site writes blocked", async () => {
    const { ctx } = await makeCtx();
    expect((await dispatch(req("GET", "/api/admin/overview"), ctx)).status).toBe(401);
    expect((await dispatch(req("GET", "/api/admin/overview", { token: signMockToken(ctx, "mock-sponsor-b") }), ctx)).status).toBe(403);
    const admin = signMockToken(ctx, "mock-admin");
    expect((await dispatch(req("GET", "/api/admin/overview", { token: admin }), ctx)).status).toBe(200);
    const body = { source_id: "X9", type: "OTHER", name: "x" };
    expect((await dispatch(req("POST", "/api/admin/sources", { token: admin, body, origin: "https://evil.example", host: "localhost:3000" }), ctx)).status).toBe(403);
    expect((await dispatch(req("POST", "/api/admin/sources", { token: admin, body, origin: "http://localhost:3000", host: "localhost:3000" }), ctx)).status).toBe(201);
    // Mock login is impossible when mock login is not allowed (e.g. a production build).
    const locked = { ...ctx, cfg: { ...ctx.cfg, allowMockLogin: false } };
    expect((await dispatch(req("POST", "/api/auth/mock-login", { body: { user_id: "mock-admin" } }), locked)).status).toBe(404);
    expect((await dispatch(req("GET", "/api/admin/overview", { token: admin }), locked)).status).toBe(401);
  });

  it("15. story generation: validates template + vibe, counts generations; photo is never sent", async () => {
    const { ctx, repo } = await makeCtx();
    const sid = await newSession(ctx);
    const s = await requireSession(ctx, sid);
    const tpl = (await repo.listStoryTemplates())[0];
    const r = await recordStoryGeneration(ctx, s, { template_id: tpl.template_id, vibe: "DEAL_HUNTER" });
    expect(r.generation_id).toMatch(/^sty_/);
    expect((await repo.getStats()).stories_generated).toBe(1);
    await expect(recordStoryGeneration(ctx, s, { template_id: tpl.template_id, vibe: "INFLUENCER" })).rejects.toMatchObject({ code: "INVALID_VIBE" });
    await expect(recordStoryGeneration(ctx, s, { template_id: "nope", vibe: "SHOPPER" })).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
    const gen = [...repo.generations.values()][0];
    expect(Object.keys(gen).sort()).toEqual(["created_at", "generation_id", "participant_id", "session_id", "source_id", "template_id", "vibe"]);
  });

  it("16. QR source tracking: ?src=H001 stores source, type, location, timestamp and session per visit", async () => {
    const { ctx, repo } = await makeCtx();
    const s1 = await touchSession(ctx, { src: "h001", event: "visit" });
    await touchSession(ctx, { session_id: s1.session_id, src: "H001", event: "visit" });
    await touchSession(ctx, { src: "NOPE99", event: "visit" }); // unknown → direct, not a QR scan
    const visits = await repo.listSourceVisits("H001", 10);
    expect(visits).toHaveLength(2);
    expect(visits[0]).toMatchObject({ source_id: "H001", source_type: "HOARDING", location: "Salem Junction", session_id: s1.session_id, new_session: false, created_at: DURING_EVENT.toISOString() });
    expect(visits[1].new_session).toBe(true);
    expect((await repo.getStats()).qr_scans).toBe(2);
    expect((await repo.getSource("H001"))!.scans).toBe(2);
  });
});

describe("campaign status", () => {
  afterEach(() => setClock(null));
  it("paused campaigns accept no new plays but existing holds can still be claimed", async () => {
    freezeClock(DURING_EVENT);
    const { ctx } = await makeCtx();
    const held = await newSession(ctx);
    await playRewardMachine(ctx, await requireSession(ctx, held), 0);
    const paused = { ...ctx, cfg: { ...ctx.cfg, campaignStatus: "paused" as const } };
    await expect(playRewardMachine(paused, await requireSession(paused, await newSession(paused)), 0)).rejects.toMatchObject({ code: "CAMPAIGN_CLOSED" });
    await verifySession(paused, held);
    expect((await claimReward(paused, await requireSession(paused, held))).play.status).toBe("CLAIMED");
  });
});
