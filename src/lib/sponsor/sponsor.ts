import type { AppContext } from "@/lib/context";
import { effectiveCouponStatus } from "@/lib/coupons/coupons";
import { rewardIssuesCoupon } from "@/lib/rewards/engine";

/**
 * Sponsor dashboard data. Every query is scoped by the caller's sponsor_id, which the auth
 * layer derives server-side. Nothing here returns participant data, other sponsors, sources,
 * campaign totals or Lucky Draw data.
 */

export async function sponsorCouponInventory(ctx: AppContext, sponsorId: string) {
  const rewards = (await ctx.repo.listRewardsBySponsor(sponsorId)).filter(rewardIssuesCoupon);
  const rows = rewards.map((r) => {
    const total = r.total_limit;
    const claimed = r.claimed_count;
    const redeemed = r.redeemed_count;
    // "remaining" = units not yet claimed by a verified participant (a short-lived hold counts as remaining).
    const remaining = total === null ? null : Math.max(0, total - claimed);
    return { reward_name: r.name, active: r.active, total, claimed, remaining, redeemed };
  });
  const sum = (k: "claimed" | "redeemed") => rows.reduce((s, r) => s + r[k], 0);
  const limited = rows.filter((r) => r.total !== null);
  return {
    totals: {
      total: limited.reduce((s, r) => s + (r.total ?? 0), 0),
      claimed: sum("claimed"),
      remaining: limited.reduce((s, r) => s + (r.remaining ?? 0), 0),
      redeemed: sum("redeemed"),
    },
    rewards: rows,
  };
}

export async function sponsorRedemptions(ctx: AppContext, sponsorId: string) {
  const coupons = await ctx.repo.listCouponsBySponsor(sponsorId);
  return coupons
    .filter((c) => c.sponsor_id === sponsorId && c.status !== "ISSUED" && c.status !== "CANCELLED")
    .map((c) => ({ coupon_code: c.coupon_code, status: effectiveCouponStatus(c), redeemed_at: c.redeemed_at }))
    .sort((a, b) => (b.redeemed_at ?? "").localeCompare(a.redeemed_at ?? ""));
}
