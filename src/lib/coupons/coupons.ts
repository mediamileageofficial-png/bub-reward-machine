import type { AppContext } from "@/lib/context";
import { AppError, ConditionFailedError, badRequest, forbidden, notFound } from "@/lib/errors";
import { COUPON_CODE_PATTERN } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import type { Actor } from "@/lib/auth/actor";
import type { Coupon, CouponStatus } from "@/types";

export function normalizeCouponCode(raw: unknown): string {
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!COUPON_CODE_PATTERN.test(code)) throw badRequest("INVALID_COUPON_CODE", "That doesn't look like a BUB coupon code.");
  return code;
}

/** Status as it should be shown now: ISSUED/CLAIMED past valid_until reads as EXPIRED. */
export function effectiveCouponStatus(c: Pick<Coupon, "status" | "valid_until">, at = nowIso()): CouponStatus {
  if ((c.status === "ISSUED" || c.status === "CLAIMED") && c.valid_until && at > c.valid_until) return "EXPIRED";
  return c.status;
}

/**
 * GET /api/coupon/:code — public lookup for the coupon holder / stall check.
 * Returns no participant data. Unclaimed (ISSUED/CANCELLED) coupons are reported as not found
 * so held-but-unclaimed codes cannot be probed.
 */
export async function getPublicCoupon(ctx: AppContext, rawCode: unknown) {
  const code = normalizeCouponCode(rawCode);
  const c = await ctx.repo.getCoupon(code);
  if (!c || c.status === "ISSUED" || c.status === "CANCELLED") throw notFound("COUPON_NOT_FOUND", "Coupon not found.");
  const reward = await ctx.repo.getReward(c.reward_id);
  const sponsor = await ctx.repo.getSponsor(c.sponsor_id);
  return {
    coupon_code: c.coupon_code,
    status: effectiveCouponStatus(c),
    reward_name: reward?.name ?? "",
    reward_description: reward?.description ?? "",
    sponsor_name: sponsor?.name ?? "",
    sponsor_logo_url: sponsor?.logo_url ?? null,
    valid_from: c.valid_from,
    valid_until: c.valid_until,
    redeemed_at: c.redeemed_at,
  };
}

/**
 * Redeem a coupon at the stall. V1: BUB/Aurix ADMIN. A SPONSOR may redeem its own coupons only
 * when SPONSOR_SELF_REDEMPTION=true. Authorisation is enforced here, server-side.
 */
export async function redeemCoupon(ctx: AppContext, actor: Actor, rawCode: unknown) {
  const code = normalizeCouponCode(rawCode);
  const c = await ctx.repo.getCoupon(code);
  if (!c || c.status === "ISSUED" || c.status === "CANCELLED") throw notFound("COUPON_NOT_FOUND", "Coupon not found.");

  if (actor.role === "SPONSOR") {
    if (!ctx.cfg.sponsorSelfRedemption) throw forbidden("Coupon redemption is handled by the BUB team in V1.");
    if (actor.sponsor_id !== c.sponsor_id) throw notFound("COUPON_NOT_FOUND", "Coupon not found."); // don't reveal other sponsors' codes
  } else if (actor.role !== "ADMIN") {
    throw forbidden();
  }

  const t = nowIso();
  if (c.status === "REDEEMED") {
    const when = c.redeemed_at ? new Date(c.redeemed_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.cfg.eventTimezone }) : "earlier";
    throw new AppError(409, "ALREADY_REDEEMED", `Already redeemed (${when}).`, { redeemed_at: c.redeemed_at });
  }
  if (effectiveCouponStatus(c, t) === "EXPIRED") {
    await ctx.repo.setCouponStatus(code, ["ISSUED", "CLAIMED"], "EXPIRED", t).catch(() => undefined);
    throw new AppError(409, "COUPON_EXPIRED", "This coupon has expired.");
  }
  if (c.valid_from && t < c.valid_from) throw new AppError(409, "COUPON_NOT_YET_VALID", "This coupon can be redeemed only during the event.", { valid_from: c.valid_from });
  if (c.status !== "CLAIMED") throw new AppError(409, "NOT_REDEEMABLE", `Coupon is ${c.status}.`);

  try {
    const redeemed = await ctx.repo.redeemCoupon(code, actor.user_id, t);
    await ctx.repo.incrementStat("coupons_redeemed");
    return redeemed;
  } catch (e) {
    if (e instanceof ConditionFailedError) throw new AppError(409, "ALREADY_REDEEMED", "This coupon was just redeemed.");
    throw e;
  }
}
