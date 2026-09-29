import { randomInt } from "node:crypto";
import type { AppContext } from "@/lib/context";
import { AppError, ConditionFailedError, conflict, badRequest } from "@/lib/errors";
import { newCouponCode, newId } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { addMinutes, dayKey as toDayKey, now, nowIso } from "@/lib/time";
import type { Coupon, Play, Reward, Session, Sponsor } from "@/types";

/**
 * REWARD ENGINE
 *
 * Allocation happens only on the server, in two atomic steps:
 *
 *  1. PLAY  (before WhatsApp verification): an eligible reward is chosen and ONE unit is
 *     *held* for this session — inventory and the daily counter are decremented inside a
 *     single conditional transaction, so two concurrent plays can never take the same unit.
 *     A coupon-type reward also gets a unique coupon row in status ISSUED (code not shown yet).
 *
 *  2. CLAIM (after WhatsApp OTP): the hold becomes CLAIMED, the phone number is locked as
 *     "played", the coupon becomes CLAIMED and is revealed. One number = one claim, enforced
 *     by a conditional write on the phone lock.
 *
 * Holds that are never claimed expire after REWARD_HOLD_MINUTES and are swept back into
 * inventory (sweepExpiredHolds — runs opportunistically on play and on a schedule in AWS).
 *
 * Selection: among eligible regular rewards, probability ∝ weight × remaining units
 * (unlimited rewards count as weight × 1). Fallback rewards are used only when no regular
 * reward can be held. Probabilities and inventory are never exposed to the client.
 */

export type PlayOutcome = "REWARD" | "ENTRY" | "NONE";

export interface PublicPlayView {
  play_id: string;
  box_index: number;
  outcome: PlayOutcome;
  status: "PENDING_VERIFICATION" | "CLAIMED" | "EXPIRED";
  reward: {
    name: string;
    description: string;
    type: Reward["type"];
    sponsor_name: string;
    sponsor_logo_url: string | null;
    issues_coupon: boolean;
  } | null;
  hold_expires_at: string | null;
}

export function rewardIssuesCoupon(r: Pick<Reward, "type">): boolean {
  return r.type !== "ENTRY_ONLY";
}

export interface EligibilityInput {
  reward: Reward;
  sponsor: Sponsor | null;
  at: Date;
  dailyCount: number;
}

/** Pure eligibility check (the atomic transaction re-checks inventory, daily limit and active flag). */
export function isRewardEligible({ reward, sponsor, at, dailyCount }: EligibilityInput): boolean {
  if (!reward.active) return false;
  if (!sponsor || !sponsor.active) return false;
  const t = at.toISOString();
  if (reward.valid_from && t < reward.valid_from) return false;
  if (reward.valid_until && t > reward.valid_until) return false;
  if (reward.remaining_inventory !== null && reward.remaining_inventory <= 0) return false;
  if (reward.daily_limit !== null && dailyCount >= reward.daily_limit) return false;
  return true;
}

/** Cryptographically random weighted ordering (without replacement). */
export function weightedOrder<T>(items: T[], weightOf: (t: T) => number): T[] {
  const pool = items.map((item) => ({ item, w: Math.max(0, Math.round(weightOf(item) * 1000)) })).filter((p) => p.w > 0);
  const out: T[] = [];
  while (pool.length) {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let pick = randomInt(total);
    let idx = 0;
    for (; idx < pool.length; idx++) {
      pick -= pool[idx].w;
      if (pick < 0) break;
    }
    out.push(pool[idx].item);
    pool.splice(idx, 1);
  }
  return out;
}

function selectionWeight(r: Reward): number {
  const units = r.remaining_inventory === null ? 1 : r.remaining_inventory;
  return Math.max(0, r.weight) * Math.max(0, units);
}

function couponValidity(r: Reward): { valid_from: string | null; valid_until: string | null } {
  return { valid_from: r.redeem_from ?? r.valid_from, valid_until: r.redeem_until ?? r.valid_until };
}

async function eligibleRewards(ctx: AppContext, at: Date, dk: string) {
  const [rewards, sponsors] = await Promise.all([ctx.repo.listRewards(), ctx.repo.listSponsors()]);
  const sponsorById = new Map(sponsors.map((s) => [s.sponsor_id, s]));
  const out: Reward[] = [];
  for (const r of rewards) {
    const dailyCount = r.daily_limit !== null ? await ctx.repo.getDailyCount(r.reward_id, dk) : 0;
    if (isRewardEligible({ reward: r, sponsor: sponsorById.get(r.sponsor_id) ?? null, at, dailyCount })) out.push(r);
  }
  return { regular: out.filter((r) => !r.fallback), fallback: out.filter((r) => r.fallback) };
}

/** Try to hold one unit of `reward` for this session. Returns the play, or null if the reward just ran out. */
async function tryHold(ctx: AppContext, session: Session, reward: Reward, boxIndex: number, at: Date, dk: string): Promise<Play | null> {
  const ts = at.toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const play: Play = {
      play_id: newId("ply"),
      session_id: session.session_id,
      source_id: session.source_id,
      box_index: boxIndex,
      reward_id: reward.reward_id,
      sponsor_id: reward.sponsor_id,
      coupon_code: null,
      status: "HELD",
      day_key: dk,
      hold_expires_at: addMinutes(at, ctx.cfg.rewards.holdMinutes).toISOString(),
      participant_id: null,
      created_at: ts,
      updated_at: ts,
    };
    let coupon: Coupon | null = null;
    if (rewardIssuesCoupon(reward)) {
      const code = newCouponCode();
      play.coupon_code = code;
      coupon = {
        coupon_id: newId("cpn"),
        coupon_code: code,
        participant_id: null,
        play_id: play.play_id,
        sponsor_id: reward.sponsor_id,
        reward_id: reward.reward_id,
        status: "ISSUED",
        issued_at: ts,
        claimed_at: null,
        redeemed_at: null,
        redeemed_by: null,
        ...couponValidity(reward),
        created_at: ts,
        updated_at: ts,
      };
    }
    try {
      await ctx.repo.holdReward({ play, coupon, reward, dayKey: dk });
      return play;
    } catch (e) {
      if (!(e instanceof ConditionFailedError)) throw e;
      if (e.reason === "COUPON_CODE_COLLISION" || e.reason === "TRANSACTION_CONFLICT") continue; // retry with a fresh code
      if (e.reason === "SESSION_ALREADY_PLAYED") throw e;
      return null; // INVENTORY / DAILY_LIMIT / REWARD_INACTIVE — try the next reward
    }
  }
  return null;
}

/** Core allocation: returns a HELD play, or an empty NO_REWARD play if nothing at all is available. */
export async function allocate(ctx: AppContext, session: Session, boxIndex: number): Promise<Play> {
  const at = now();
  const dk = toDayKey(at, ctx.cfg.eventTimezone);
  const { regular, fallback } = await eligibleRewards(ctx, at, dk);

  for (const reward of weightedOrder(regular, selectionWeight)) {
    const play = await tryHold(ctx, session, reward, boxIndex, at, dk);
    if (play) return play;
  }
  for (const reward of weightedOrder(fallback, (r) => Math.max(1, r.weight))) {
    const play = await tryHold(ctx, session, reward, boxIndex, at, dk);
    if (play) return play;
  }

  const ts = at.toISOString();
  const empty: Play = {
    play_id: newId("ply"),
    session_id: session.session_id,
    source_id: session.source_id,
    box_index: boxIndex,
    reward_id: null,
    sponsor_id: null,
    coupon_code: null,
    status: "NO_REWARD",
    day_key: dk,
    hold_expires_at: null,
    participant_id: null,
    created_at: ts,
    updated_at: ts,
  };
  await ctx.repo.recordEmptyPlay(empty);
  logger.warn("rewards.no_inventory", { session: session.session_id.slice(0, 8) });
  return empty;
}

/** POST /api/play — idempotent per session. */
export async function playRewardMachine(ctx: AppContext, session: Session, boxIndex: number): Promise<PublicPlayView> {
  if (!Number.isInteger(boxIndex) || boxIndex < 0 || boxIndex > 2) throw badRequest("INVALID_BOX", "Pick one of the three boxes.");
  if (ctx.cfg.campaignStatus !== "live" && !session.play_id) {
    throw new AppError(403, "CAMPAIGN_CLOSED", ctx.cfg.campaignStatus === "ended" ? "The BUB Reward Machine has closed. Thank you for playing!" : "The BUB Reward Machine is paused right now. Please check back soon.");
  }

  if (session.play_id) {
    const existing = await ctx.repo.getPlay(session.play_id);
    if (existing) return publicPlayView(ctx, existing);
  }
  // A verified number that already claimed cannot play again, even from a new session.
  if (session.verified_phone) {
    const lock = await ctx.repo.getPhoneLock(session.verified_phone);
    if (lock?.reward_claimed) throw conflict("ALREADY_PLAYED", "This WhatsApp number has already played the BUB Reward Machine.");
  }

  await sweepExpiredHolds(ctx, 10).catch((e) => logger.warn("rewards.sweep_failed", { error: (e as Error).message }));

  let play: Play;
  try {
    play = await allocate(ctx, session, boxIndex);
  } catch (e) {
    if (e instanceof ConditionFailedError && e.reason === "SESSION_ALREADY_PLAYED") {
      const fresh = await ctx.repo.getSession(session.session_id);
      const existing = fresh?.play_id ? await ctx.repo.getPlay(fresh.play_id) : null;
      if (existing) return publicPlayView(ctx, existing);
    }
    throw e;
  }
  await ctx.repo.incrementStat("game_plays");
  if (session.source_id) await ctx.repo.incrementSourceCounter(session.source_id, "plays");
  return publicPlayView(ctx, play);
}

export async function publicPlayView(ctx: AppContext, play: Play): Promise<PublicPlayView> {
  const reward = play.reward_id ? await ctx.repo.getReward(play.reward_id) : null;
  const sponsor = reward ? await ctx.repo.getSponsor(reward.sponsor_id) : null;
  const outcome: PlayOutcome = !reward ? "NONE" : rewardIssuesCoupon(reward) ? "REWARD" : "ENTRY";
  return {
    play_id: play.play_id,
    box_index: play.box_index,
    outcome,
    status: play.status === "CLAIMED" || (play.status === "NO_REWARD" && play.participant_id) ? "CLAIMED" : play.status === "EXPIRED" ? "EXPIRED" : "PENDING_VERIFICATION",
    reward: reward
      ? {
          name: reward.name,
          description: reward.description,
          type: reward.type,
          sponsor_name: sponsor?.name ?? "",
          sponsor_logo_url: sponsor?.logo_url ?? null,
          issues_coupon: rewardIssuesCoupon(reward),
        }
      : null,
    hold_expires_at: play.status === "HELD" ? play.hold_expires_at : null,
  };
}

export interface ClaimResult {
  play: PublicPlayView;
  coupon: { coupon_code: string; status: Coupon["status"]; valid_from: string | null; valid_until: string | null } | null;
  reward_changed: boolean;
  whatsapp: { status: "MOCKED" | "ACCEPTED" | "FAILED" | "SKIPPED" };
}

/**
 * POST /api/reward/claim — requires a WhatsApp-verified session.
 * Idempotent for the same participant; a second number-level claim is rejected.
 */
export async function claimReward(ctx: AppContext, session: Session): Promise<ClaimResult> {
  const { repo } = ctx;
  if (!session.verified_phone || !session.participant_id) {
    throw new AppError(403, "VERIFICATION_REQUIRED", "Verify your WhatsApp number to claim your reward.");
  }
  const participant = await repo.getParticipant(session.participant_id);
  if (!participant) throw new AppError(403, "VERIFICATION_REQUIRED", "Verify your WhatsApp number to claim your reward.");
  const lock = await repo.getPhoneLock(participant.phone);

  // Already claimed by this number → return that claim (idempotent), never a second reward.
  if (lock?.reward_claimed) {
    // A fresh hold on this session is surplus: give the unit back to inventory straight away.
    if (session.play_id && session.play_id !== lock.play_id) {
      const surplus = await repo.getPlay(session.play_id);
      if (surplus?.status === "HELD") {
        const r = surplus.reward_id ? await repo.getReward(surplus.reward_id) : null;
        await repo.releaseHold({ play: surplus, reward: r, now: nowIso(), force: true }).catch(() => undefined);
      }
    }
    const prevPlay = lock.play_id ? await repo.getPlay(lock.play_id) : null;
    if (prevPlay && prevPlay.participant_id === participant.participant_id) {
      const coupon = prevPlay.coupon_code ? await repo.getCoupon(prevPlay.coupon_code) : null;
      return {
        play: await publicPlayView(ctx, prevPlay),
        coupon: coupon ? { coupon_code: coupon.coupon_code, status: coupon.status, valid_from: coupon.valid_from, valid_until: coupon.valid_until } : null,
        reward_changed: prevPlay.play_id !== session.play_id,
        whatsapp: { status: "SKIPPED" },
      };
    }
    throw conflict("ALREADY_PLAYED", "This WhatsApp number has already played the BUB Reward Machine.");
  }

  if (!session.play_id) throw badRequest("PLAY_FIRST", "Pick a BUB box first.");
  let play = await repo.getPlay(session.play_id);
  if (!play) throw badRequest("PLAY_FIRST", "Pick a BUB box first.");
  let rewardChanged = false;

  // Hold expired (or swept) before the claim → allocate afresh for this session.
  if (play.status === "EXPIRED" || (play.status === "HELD" && play.hold_expires_at && play.hold_expires_at < nowIso())) {
    if (play.status === "HELD") {
      const reward = play.reward_id ? await repo.getReward(play.reward_id) : null;
      await repo.releaseHold({ play, reward, now: nowIso() }).catch(() => undefined);
    }
    await repo.updateSession(session.session_id, { play_id: null });
    play = await allocate(ctx, { ...session, play_id: null }, play.box_index);
    rewardChanged = true;
  }

  const ts = nowIso();
  try {
    await repo.claimReward({ play, participantId: participant.participant_id, phone: participant.phone, now: ts });
  } catch (e) {
    if (e instanceof ConditionFailedError) {
      if (e.reason === "PHONE_ALREADY_CLAIMED") throw conflict("ALREADY_PLAYED", "This WhatsApp number has already played the BUB Reward Machine.");
      if (e.reason === "PLAY_NOT_HELD" || e.reason === "COUPON_NOT_ISSUED") {
        // Lost a race with the expiry sweeper — try once more with a fresh allocation.
        const current = await repo.getPlay(play.play_id);
        if (current?.status === "CLAIMED" && current.participant_id === participant.participant_id) return claimReward(ctx, { ...session, play_id: current.play_id });
        await repo.updateSession(session.session_id, { play_id: null });
        const fresh = await allocate(ctx, { ...session, play_id: null }, play.box_index);
        await repo.claimReward({ play: fresh, participantId: participant.participant_id, phone: participant.phone, now: nowIso() });
        play = fresh;
        rewardChanged = true;
      } else throw e;
    } else throw e;
  }

  const claimed = (await repo.getPlay(play.play_id))!;
  const coupon = claimed.coupon_code ? await repo.getCoupon(claimed.coupon_code) : null;
  const reward = claimed.reward_id ? await repo.getReward(claimed.reward_id) : null;
  const sponsor = reward ? await repo.getSponsor(reward.sponsor_id) : null;

  if (reward) {
    await repo.incrementStat("rewards_won");
    if (claimed.source_id) await repo.incrementSourceCounter(claimed.source_id, "rewards");
  }
  if (coupon) await repo.incrementStat("coupons_issued");

  // Best-effort WhatsApp confirmation. The claim never depends on delivery.
  let whatsappStatus: ClaimResult["whatsapp"]["status"] = "SKIPPED";
  if (reward && coupon) {
    try {
      const r = await ctx.whatsapp.sendCouponMessage(participant.phone, {
        name: participant.name.split(" ")[0],
        couponCode: coupon.coupon_code,
        rewardName: `${reward.name}${sponsor ? ` — ${sponsor.name}` : ""}`,
        validUntil: coupon.valid_until ? new Date(coupon.valid_until).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: ctx.cfg.eventTimezone }) : "the event",
        couponUrl: `${ctx.cfg.appBaseUrl}/reward?code=${encodeURIComponent(coupon.coupon_code)}`,
      });
      whatsappStatus = r.status;
    } catch (e) {
      logger.warn("claim.whatsapp_failed", { error: (e as Error).message });
      whatsappStatus = "FAILED";
    }
  }

  return {
    play: await publicPlayView(ctx, claimed),
    coupon: coupon ? { coupon_code: coupon.coupon_code, status: coupon.status, valid_from: coupon.valid_from, valid_until: coupon.valid_until } : null,
    reward_changed: rewardChanged,
    whatsapp: { status: whatsappStatus },
  };
}

/** Returns expired, unclaimed holds to inventory. Safe to run concurrently (conditional writes). */
export async function sweepExpiredHolds(ctx: AppContext, limit = 100): Promise<number> {
  const ts = nowIso();
  const expired = await ctx.repo.listExpiredHolds(ts, limit);
  let released = 0;
  for (const play of expired) {
    const reward = play.reward_id ? await ctx.repo.getReward(play.reward_id) : null;
    try {
      await ctx.repo.releaseHold({ play, reward, now: ts });
      released++;
    } catch (e) {
      if (!(e instanceof ConditionFailedError)) throw e;
    }
  }
  if (released) logger.info("rewards.holds_released", { released });
  return released;
}
