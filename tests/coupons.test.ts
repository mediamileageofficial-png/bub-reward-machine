import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireSession } from "@/lib/tracking/sessions";
import { playRewardMachine, claimReward } from "@/lib/rewards/engine";
import { getPublicCoupon, redeemCoupon, effectiveCouponStatus } from "@/lib/coupons/coupons";
import { newCouponCode, COUPON_CODE_PATTERN } from "@/lib/ids";
import { setClock } from "@/lib/time";
import { makeCtx, newSession, verifySession, onlyRewards, freezeClock, DURING_EVENT, BEFORE_EVENT, SEED_REWARD_IDS } from "./helpers";
import type { Actor } from "@/lib/auth/actor";
import type { AppContext } from "@/lib/context";

const ADMIN: Actor = { user_id: "mock-admin", email: "admin@bub.local", role: "ADMIN", sponsor_id: null };
const SPONSOR_A: Actor = { user_id: "mock-sponsor-a", email: "a@x", role: "SPONSOR", sponsor_id: "spn_sample_a" };

async function claimedCoupon(ctx: AppContext) {
  const sid = await newSession(ctx);
  await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
  await verifySession(ctx, sid);
  const c = await claimReward(ctx, await requireSession(ctx, sid));
  return c.coupon!.coupon_code;
}

describe("6. unique coupon generation", () => {
  beforeEach(() => freezeClock(DURING_EVENT));
  afterEach(() => setClock(null));

  it("generates well-formed codes", () => {
    const codes = new Set(Array.from({ length: 5000 }, () => newCouponCode()));
    for (const c of codes) expect(c).toMatch(COUPON_CODE_PATTERN);
    expect(codes.size).toBeGreaterThan(4990); // collisions are possible in theory; the DB write guards them
  });

  it("every allocated coupon has a unique code", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.OFFER]);
    const sessions = await Promise.all(Array.from({ length: 100 }, () => newSession(ctx)));
    await Promise.all(sessions.map(async (s) => playRewardMachine(ctx, await requireSession(ctx, s), 1)));
    const codes = [...repo.coupons.keys()];
    expect(codes).toHaveLength(100);
    expect(new Set(codes).size).toBe(100);
  });

  it("the store rejects a duplicate code atomically (engine then retries with a new code)", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.OFFER]);
    const s1 = await newSession(ctx);
    await playRewardMachine(ctx, await requireSession(ctx, s1), 0);
    const existing = [...repo.coupons.values()][0];
    const reward = (await repo.getReward(SEED_REWARD_IDS.OFFER))!;
    const s2 = await requireSession(ctx, await newSession(ctx));
    const before = reward.remaining_inventory;
    await expect(
      repo.holdReward({
        play: { play_id: "ply_x", session_id: s2.session_id, source_id: null, box_index: 0, reward_id: reward.reward_id, sponsor_id: reward.sponsor_id, coupon_code: existing.coupon_code, status: "HELD", day_key: "2026-10-15", hold_expires_at: null, participant_id: null, created_at: "", updated_at: "" },
        coupon: { ...existing, coupon_id: "cpn_x", play_id: "ply_x" },
        reward,
        dayKey: "2026-10-15",
      }),
    ).rejects.toMatchObject({ reason: "COUPON_CODE_COLLISION" });
    // Nothing was consumed by the failed transaction.
    expect((await repo.getReward(SEED_REWARD_IDS.OFFER))!.remaining_inventory).toBe(before);
  });
});

describe("7. coupon redemption", () => {
  afterEach(() => setClock(null));

  it("admin redeems a claimed coupon exactly once and redeemed_count increments", async () => {
    freezeClock(DURING_EVENT);
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER]);
    const code = await claimedCoupon(ctx);
    expect((await getPublicCoupon(ctx, code.toLowerCase())).status).toBe("CLAIMED");

    const redeemed = await redeemCoupon(ctx, ADMIN, code);
    expect(redeemed.status).toBe("REDEEMED");
    expect(redeemed.redeemed_at).toBe(DURING_EVENT.toISOString());
    expect((await repo.getReward(SEED_REWARD_IDS.VOUCHER))!.redeemed_count).toBe(1);
    expect((await repo.getStats()).coupons_redeemed).toBe(1);
    await expect(redeemCoupon(ctx, ADMIN, code)).rejects.toMatchObject({ code: "ALREADY_REDEEMED" });
  });

  it("concurrent redemption of the same coupon succeeds exactly once", async () => {
    freezeClock(DURING_EVENT);
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER]);
    const code = await claimedCoupon(ctx);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => redeemCoupon(ctx, ADMIN, code)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await repo.getReward(SEED_REWARD_IDS.VOUCHER))!.redeemed_count).toBe(1);
  });

  it("refuses redemption before the event window and after expiry", async () => {
    const clock = freezeClock(BEFORE_EVENT);
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER]);
    const code = await claimedCoupon(ctx);
    await expect(redeemCoupon(ctx, ADMIN, code)).rejects.toMatchObject({ code: "COUPON_NOT_YET_VALID" });
    clock.set(new Date("2026-10-20T00:00:00.000Z"));
    expect((await getPublicCoupon(ctx, code)).status).toBe("EXPIRED");
    await expect(redeemCoupon(ctx, ADMIN, code)).rejects.toMatchObject({ code: "COUPON_EXPIRED" });
    expect((await repo.getCoupon(code))!.status).toBe("EXPIRED");
    expect(effectiveCouponStatus({ status: "REDEEMED", valid_until: "2020-01-01T00:00:00.000Z" })).toBe("REDEEMED");
  });

  it("held-but-unclaimed coupons cannot be looked up or redeemed", async () => {
    freezeClock(DURING_EVENT);
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER]);
    const sid = await newSession(ctx);
    await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
    const held = [...repo.coupons.values()][0];
    expect(held.status).toBe("ISSUED");
    await expect(getPublicCoupon(ctx, held.coupon_code)).rejects.toMatchObject({ code: "COUPON_NOT_FOUND" });
    await expect(redeemCoupon(ctx, ADMIN, held.coupon_code)).rejects.toMatchObject({ code: "COUPON_NOT_FOUND" });
  });

  it("sponsors cannot redeem in V1 (unless SPONSOR_SELF_REDEMPTION) and never other sponsors' codes", async () => {
    freezeClock(DURING_EVENT);
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.PRODUCT]); // Sponsor B's reward
    const code = await claimedCoupon(ctx);
    await expect(redeemCoupon(ctx, SPONSOR_A, code)).rejects.toMatchObject({ status: 403 });
    const enabled = { ...ctx, cfg: { ...ctx.cfg, sponsorSelfRedemption: true } };
    await expect(redeemCoupon(enabled, SPONSOR_A, code)).rejects.toMatchObject({ code: "COUPON_NOT_FOUND" });
    const sponsorB: Actor = { ...SPONSOR_A, user_id: "b", sponsor_id: "spn_sample_b" };
    expect((await redeemCoupon(enabled, sponsorB, code)).status).toBe("REDEEMED");
  });

  it("public lookup exposes no participant data", async () => {
    freezeClock(DURING_EVENT);
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER]);
    const code = await claimedCoupon(ctx);
    const json = JSON.stringify(await getPublicCoupon(ctx, code));
    expect(json).not.toMatch(/participant|phone|\+91|Test Person/);
  });
});
