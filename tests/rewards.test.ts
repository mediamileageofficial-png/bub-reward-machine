import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireSession } from "@/lib/tracking/sessions";
import { playRewardMachine, claimReward, sweepExpiredHolds, weightedOrder, isRewardEligible } from "@/lib/rewards/engine";
import { setClock } from "@/lib/time";
import { makeCtx, newSession, verifySession, onlyRewards, setReward, freezeClock, nextPhone, DURING_EVENT, SEED_REWARD_IDS } from "./helpers";
import type { AppContext } from "@/lib/context";

async function playAndClaim(ctx: AppContext, phone = nextPhone()) {
  const sid = await newSession(ctx);
  const play = await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
  await verifySession(ctx, sid, phone);
  const claim = await claimReward(ctx, await requireSession(ctx, sid));
  return { sid, play, claim };
}

describe("reward engine", () => {
  let clock: ReturnType<typeof freezeClock>;
  beforeEach(() => {
    clock = freezeClock(DURING_EVENT);
  });
  afterEach(() => setClock(null));

  it("2. one WhatsApp number can play/claim only once, across sessions", async () => {
    const { ctx } = await makeCtx();
    const phone = nextPhone();
    const first = await playAndClaim(ctx, phone);
    expect(first.claim.play.status).toBe("CLAIMED");

    // Same number, new session: verification works but is flagged; "claiming" returns the ORIGINAL
    // reward, never a second one, and the surplus hold goes straight back to inventory.
    const sid2 = await newSession(ctx);
    const second = await playRewardMachine(ctx, await requireSession(ctx, sid2), 2);
    const v = await verifySession(ctx, sid2, phone);
    expect(v.already_played).toBe(true);
    expect(v.existing_coupon_code).toBe(first.claim.coupon?.coupon_code ?? null);
    const again = await claimReward(ctx, await requireSession(ctx, sid2));
    expect(again.play.play_id).toBe(first.claim.play.play_id);
    expect(again.coupon?.coupon_code).toBe(first.claim.coupon?.coupon_code);
    expect((await ctx.repo.getPlay(second.play_id))?.status).toBe("EXPIRED");
    expect((await ctx.repo.getStats()).rewards_won).toBe(1);
    const totals = await ctx.repo.listRewards();
    for (const r of totals.filter((x) => x.total_limit !== null)) expect(r.remaining_inventory! + r.claimed_count).toBe(r.total_limit);

    // And a verified session for that number cannot even start a new play.
    const sid3 = await newSession(ctx);
    await verifySession(ctx, sid3, phone);
    await expect(playRewardMachine(ctx, await requireSession(ctx, sid3), 0)).rejects.toMatchObject({ code: "ALREADY_PLAYED" });
  });

  it("2b. play is idempotent per session and claim is idempotent for the same participant", async () => {
    const { ctx, repo } = await makeCtx();
    const sid = await newSession(ctx);
    const a = await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
    const b = await playRewardMachine(ctx, await requireSession(ctx, sid), 2);
    expect(b.play_id).toBe(a.play_id);
    await verifySession(ctx, sid);
    const c1 = await claimReward(ctx, await requireSession(ctx, sid));
    const c2 = await claimReward(ctx, await requireSession(ctx, sid));
    expect(c2.coupon?.coupon_code).toBe(c1.coupon?.coupon_code);
    expect((await repo.getStats()).rewards_won).toBe(1);
  });

  it("claim requires WhatsApp verification", async () => {
    const { ctx } = await makeCtx();
    const sid = await newSession(ctx);
    await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
    await expect(claimReward(ctx, await requireSession(ctx, sid))).rejects.toMatchObject({ code: "VERIFICATION_REQUIRED" });
  });

  it("3. inventory decrements on hold, claimed_count on claim, and expired holds return to inventory", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER]);
    const before = (await repo.getReward(SEED_REWARD_IDS.VOUCHER))!;
    expect(before.remaining_inventory).toBe(100);

    const sid = await newSession(ctx);
    const play = await playRewardMachine(ctx, await requireSession(ctx, sid), 1);
    expect(play.outcome).toBe("REWARD");
    expect(play.reward?.name).toBe("₹500 Voucher");
    let r = (await repo.getReward(SEED_REWARD_IDS.VOUCHER))!;
    expect(r.remaining_inventory).toBe(99);
    expect(r.claimed_count).toBe(0);

    await verifySession(ctx, sid);
    const claim = await claimReward(ctx, await requireSession(ctx, sid));
    expect(claim.coupon?.coupon_code).toMatch(/^BUB-[A-Z2-9]{6}$/);
    expect(claim.coupon?.status).toBe("CLAIMED");
    r = (await repo.getReward(SEED_REWARD_IDS.VOUCHER))!;
    expect(r.remaining_inventory).toBe(99);
    expect(r.claimed_count).toBe(1);

    // An abandoned hold is released after REWARD_HOLD_MINUTES.
    const abandoned = await newSession(ctx);
    await playRewardMachine(ctx, await requireSession(ctx, abandoned), 0);
    expect((await repo.getReward(SEED_REWARD_IDS.VOUCHER))!.remaining_inventory).toBe(98);
    clock.advanceMinutes(ctx.cfg.rewards.holdMinutes + 1);
    expect(await sweepExpiredHolds(ctx)).toBe(1);
    expect((await repo.getReward(SEED_REWARD_IDS.VOUCHER))!.remaining_inventory).toBe(99);
    const cancelled = [...repo.coupons.values()].find((c) => c.status === "CANCELLED");
    expect(cancelled).toBeTruthy();
    expect(await repo.getDailyCount(SEED_REWARD_IDS.VOUCHER, "2026-10-15")).toBe(1);
  });

  it("3b. a late claim after the hold expired gets a fresh allocation, never a double spend", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER, SEED_REWARD_IDS.FALLBACK]);
    const sid = await newSession(ctx);
    await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
    clock.advanceMinutes(ctx.cfg.rewards.holdMinutes + 5);
    await sweepExpiredHolds(ctx);
    await verifySession(ctx, sid);
    const claim = await claimReward(ctx, await requireSession(ctx, sid));
    expect(claim.reward_changed).toBe(true);
    expect(claim.play.status).toBe("CLAIMED");
    const r = (await repo.getReward(SEED_REWARD_IDS.VOUCHER))!;
    expect(r.remaining_inventory! + r.claimed_count).toBe(100);
  });

  it("4. daily limit caps allocations per event day and resets the next day", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER, SEED_REWARD_IDS.FALLBACK]);
    await setReward(repo, SEED_REWARD_IDS.VOUCHER, { daily_limit: 2 });
    const names: string[] = [];
    for (let i = 0; i < 4; i++) names.push((await playAndClaim(ctx)).claim.play.reward!.name);
    expect(names.filter((n) => n === "₹500 Voucher")).toHaveLength(2);
    expect(names.filter((n) => n === "BUB Lucky Draw Entry")).toHaveLength(2);

    clock.set(new Date("2026-10-16T04:00:00.000Z")); // next IST day
    const next = await playAndClaim(ctx);
    expect(next.claim.play.reward!.name).toBe("₹500 Voucher");
  });

  it("4b. the daily limit uses the event timezone (IST), not UTC", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER, SEED_REWARD_IDS.FALLBACK]);
    await setReward(repo, SEED_REWARD_IDS.VOUCHER, { daily_limit: 1 });
    clock.set(new Date("2026-10-15T18:00:00.000Z")); // 23:30 IST on the 15th
    expect((await playAndClaim(ctx)).claim.play.reward!.name).toBe("₹500 Voucher");
    clock.set(new Date("2026-10-15T18:40:00.000Z")); // 00:10 IST on the 16th, same UTC date
    expect((await playAndClaim(ctx)).claim.play.reward!.name).toBe("₹500 Voucher");
  });

  it("5. concurrent plays never oversell inventory (50 players, 5 units)", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER, SEED_REWARD_IDS.FALLBACK]);
    await setReward(repo, SEED_REWARD_IDS.VOUCHER, { total_limit: 5, remaining_inventory: 5, daily_limit: null });
    const sessions = await Promise.all(Array.from({ length: 50 }, () => newSession(ctx)));
    const plays = await Promise.all(sessions.map(async (sid, i) => playRewardMachine(ctx, await requireSession(ctx, sid), i % 3)));
    const won = plays.filter((p) => p.reward?.name === "₹500 Voucher");
    expect(won).toHaveLength(5);
    expect(plays.filter((p) => p.outcome === "ENTRY")).toHaveLength(45);
    const r = (await repo.getReward(SEED_REWARD_IDS.VOUCHER))!;
    expect(r.remaining_inventory).toBe(0);

    // Claim them all concurrently.
    await Promise.all(sessions.map((sid) => verifySession(ctx, sid)));
    const claims = await Promise.all(sessions.map(async (sid) => claimReward(ctx, await requireSession(ctx, sid))));
    const vouchers = claims.filter((c) => c.coupon);
    expect(vouchers).toHaveLength(5);
    expect(new Set(vouchers.map((c) => c.coupon!.coupon_code)).size).toBe(5);
    const after = (await repo.getReward(SEED_REWARD_IDS.VOUCHER))!;
    expect(after.claimed_count).toBe(5);
    expect(after.remaining_inventory).toBe(0);
  });

  it("5b. concurrent daily-limit allocation never exceeds the daily cap", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER, SEED_REWARD_IDS.FALLBACK]);
    await setReward(repo, SEED_REWARD_IDS.VOUCHER, { daily_limit: 3 });
    const sessions = await Promise.all(Array.from({ length: 30 }, () => newSession(ctx)));
    const plays = await Promise.all(sessions.map(async (sid) => playRewardMachine(ctx, await requireSession(ctx, sid), 0)));
    expect(plays.filter((p) => p.reward?.name === "₹500 Voucher")).toHaveLength(3);
    expect(await repo.getDailyCount(SEED_REWARD_IDS.VOUCHER, "2026-10-15")).toBe(3);
  });

  it("5c. the same number claiming from two sessions at once gets exactly one reward", async () => {
    const { ctx } = await makeCtx();
    const phone = nextPhone();
    const [s1, s2] = await Promise.all([newSession(ctx), newSession(ctx)]);
    await playRewardMachine(ctx, await requireSession(ctx, s1), 0);
    await playRewardMachine(ctx, await requireSession(ctx, s2), 1);
    await verifySession(ctx, s1, phone);
    await verifySession(ctx, s2, phone);
    const results = await Promise.allSettled([claimReward(ctx, await requireSession(ctx, s1)), claimReward(ctx, await requireSession(ctx, s2))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("ALREADY_PLAYED");
  });

  it("12. expired rewards are never allocated", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER, SEED_REWARD_IDS.FALLBACK]);
    await setReward(repo, SEED_REWARD_IDS.VOUCHER, { valid_until: "2026-10-14T00:00:00.000Z" });
    for (let i = 0; i < 5; i++) {
      const p = await playRewardMachine(ctx, await requireSession(ctx, await newSession(ctx)), 0);
      expect(p.reward?.name).toBe("BUB Lucky Draw Entry");
    }
    // Not-yet-valid rewards are also skipped.
    await setReward(repo, SEED_REWARD_IDS.VOUCHER, { valid_until: null, valid_from: "2026-10-20T00:00:00.000Z" });
    const p = await playRewardMachine(ctx, await requireSession(ctx, await newSession(ctx)), 0);
    expect(p.outcome).toBe("ENTRY");
  });

  it("13. inactive (paused) rewards and rewards of inactive sponsors are never allocated", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER, SEED_REWARD_IDS.PRODUCT, SEED_REWARD_IDS.FALLBACK]);
    await repo.updateReward(SEED_REWARD_IDS.VOUCHER, { active: false });
    await repo.updateSponsor("spn_sample_b", { active: false });
    for (let i = 0; i < 5; i++) {
      const p = await playRewardMachine(ctx, await requireSession(ctx, await newSession(ctx)), 0);
      expect(p.outcome).toBe("ENTRY");
    }
    // A reward paused between selection and hold is rejected by the atomic hold itself.
    await repo.updateSponsor("spn_sample_b", { active: true });
    const reward = (await repo.getReward(SEED_REWARD_IDS.PRODUCT))!;
    await repo.updateReward(SEED_REWARD_IDS.PRODUCT, { active: false });
    const session = await requireSession(ctx, await newSession(ctx));
    await expect(
      repo.holdReward({ play: { play_id: "p1", session_id: session.session_id, source_id: null, box_index: 0, reward_id: reward.reward_id, sponsor_id: reward.sponsor_id, coupon_code: null, status: "HELD", day_key: "2026-10-15", hold_expires_at: null, participant_id: null, created_at: "", updated_at: "" }, coupon: null, reward, dayKey: "2026-10-15" }),
    ).rejects.toMatchObject({ reason: "REWARD_INACTIVE" });
  });

  it("14. falls back when regular rewards are sold out, and reports NONE when nothing is left", async () => {
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.VOUCHER, SEED_REWARD_IDS.FALLBACK]);
    await setReward(repo, SEED_REWARD_IDS.VOUCHER, { total_limit: 1, remaining_inventory: 1 });
    const first = await playRewardMachine(ctx, await requireSession(ctx, await newSession(ctx)), 0);
    expect(first.outcome).toBe("REWARD");
    const second = await playRewardMachine(ctx, await requireSession(ctx, await newSession(ctx)), 0);
    expect(second.outcome).toBe("ENTRY");
    expect(second.reward?.issues_coupon).toBe(false);

    await repo.updateReward(SEED_REWARD_IDS.FALLBACK, { active: false });
    const sid = await newSession(ctx);
    const third = await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
    expect(third.outcome).toBe("NONE");
    // The player can still verify and complete the machine (and so enter the Lucky Draw).
    await verifySession(ctx, sid);
    const claim = await claimReward(ctx, await requireSession(ctx, sid));
    expect(claim.play.status).toBe("CLAIMED");
    expect(claim.coupon).toBeNull();
  });

  it("never exposes probabilities or inventory in the public play result", async () => {
    const { ctx } = await makeCtx();
    const p = await playRewardMachine(ctx, await requireSession(ctx, await newSession(ctx)), 0);
    const json = JSON.stringify(p);
    for (const k of ["weight", "remaining", "total_limit", "daily_limit", "coupon_code"]) expect(json).not.toContain(k);
  });

  it("rejects an invalid box index", async () => {
    const { ctx } = await makeCtx();
    await expect(playRewardMachine(ctx, await requireSession(ctx, await newSession(ctx)), 7)).rejects.toMatchObject({ code: "INVALID_BOX" });
  });

  it("weightedOrder returns every positive-weight item exactly once", () => {
    const items = ["a", "b", "c", "d"];
    const out = weightedOrder(items, (x) => (x === "d" ? 0 : 1));
    expect(out.sort()).toEqual(["a", "b", "c"]);
  });

  it("isRewardEligible respects remaining inventory", () => {
    const base = { active: true, valid_from: null, valid_until: null, remaining_inventory: 0, daily_limit: null } as never;
    expect(isRewardEligible({ reward: base, sponsor: { active: true } as never, at: DURING_EVENT, dailyCount: 0 })).toBe(false);
  });
});
