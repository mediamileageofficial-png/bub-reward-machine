import { randomInt } from "node:crypto";
import type { AppContext } from "@/lib/context";
import { AppError, ConditionFailedError, badRequest, conflict, notFound } from "@/lib/errors";
import { newId, newLuckyDrawId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import type { Actor } from "@/lib/auth/actor";
import type { LuckyDrawDraw, LuckyDrawEntry, Participant, Session } from "@/types";

/**
 * Eligibility (V1):
 *  - Reward Machine completed (a claim is locked against the verified number)
 *  - WhatsApp verified
 *  - participant CONFIRMED following BUB, the organizer and the title sponsor on Instagram.
 *    This is self-declared. V1 does not (and cannot, without a supported Meta API) verify follows.
 */
export interface FollowConfirmations {
  followed_bub: boolean;
  followed_organizer: boolean;
  followed_sponsor: boolean;
}

export function isLuckyDrawEligible(p: Pick<Participant, "whatsapp_verified" | "play_id">, rewardClaimed: boolean, f: FollowConfirmations): boolean {
  return p.whatsapp_verified && rewardClaimed && Boolean(p.play_id) && f.followed_bub && f.followed_organizer && f.followed_sponsor;
}

export async function enterLuckyDraw(ctx: AppContext, session: Session, f: FollowConfirmations) {
  const { repo } = ctx;
  if (!session.verified_phone || !session.participant_id) throw new AppError(403, "VERIFICATION_REQUIRED", "Verify your WhatsApp number first.");
  const participant = await repo.getParticipant(session.participant_id);
  if (!participant) throw new AppError(403, "VERIFICATION_REQUIRED", "Verify your WhatsApp number first.");

  if (participant.lucky_draw_entry_id) {
    return { entry_id: participant.lucky_draw_entry_id, entered_at: participant.entered_at, already_entered: true };
  }

  const lock = await repo.getPhoneLock(participant.phone);
  if (!lock?.reward_claimed) throw badRequest("PLAY_FIRST", "Complete the BUB Reward Machine first.");
  if (!f.followed_bub || !f.followed_organizer || !f.followed_sponsor) {
    throw badRequest("FOLLOW_CONFIRMATION_REQUIRED", "Confirm that you've followed all 3 Instagram accounts.");
  }
  const eligible = isLuckyDrawEligible({ whatsapp_verified: participant.whatsapp_verified, play_id: participant.play_id ?? lock.play_id }, lock.reward_claimed, f);
  if (!eligible) throw badRequest("NOT_ELIGIBLE", "You're not eligible for the Lucky Draw yet.");

  const ts = nowIso();
  for (let attempt = 0; attempt < 8; attempt++) {
    const entry: LuckyDrawEntry = { entry_id: newLuckyDrawId(), participant_id: participant.participant_id, source_id: participant.source_id, entered_at: ts, created_at: ts };
    try {
      await repo.createLuckyDrawEntry(entry, {
        followed_bub_confirmed: true,
        followed_organizer_confirmed: true,
        followed_sponsor_confirmed: true,
        lucky_draw_eligible: true,
        entered_at: ts,
      });
      await repo.incrementStat("lucky_draw_entries");
      return { entry_id: entry.entry_id, entered_at: ts, already_entered: false };
    } catch (e) {
      if (!(e instanceof ConditionFailedError)) throw e;
      if (e.reason === "ENTRY_ID_COLLISION") continue;
      if (e.reason === "ALREADY_ENTERED") {
        const p = await repo.getParticipant(participant.participant_id);
        return { entry_id: p?.lucky_draw_entry_id ?? null, entered_at: p?.entered_at ?? null, already_entered: true };
      }
      throw e;
    }
  }
  throw new AppError(503, "TRY_AGAIN", "Please try again.");
}

// ---------------- admin: winners ----------------

/** Entries that can still be drawn: every entry without an existing draw (a person can be drawn once). */
export async function drawablePool(ctx: AppContext): Promise<LuckyDrawEntry[]> {
  const [entries, draws] = await Promise.all([ctx.repo.listLuckyDrawEntries(), ctx.repo.listDraws()]);
  const drawn = new Set(draws.map((d) => d.entry_id));
  const out: LuckyDrawEntry[] = [];
  for (const e of entries) {
    if (drawn.has(e.entry_id)) continue;
    const p = await ctx.repo.getParticipant(e.participant_id);
    if (p?.lucky_draw_eligible) out.push(e);
  }
  return out;
}

/** Secure server-side random selection (crypto.randomInt, uniform over the eligible pool). */
export async function selectWinner(ctx: AppContext, actor: Actor, prize: unknown): Promise<LuckyDrawDraw> {
  const prizeName = typeof prize === "string" ? prize.trim().slice(0, 120) : "";
  if (!prizeName) throw badRequest("PRIZE_REQUIRED", "Enter the prize for this draw.");
  const pool = await drawablePool(ctx);
  if (!pool.length) throw conflict("NO_ELIGIBLE_ENTRIES", "No eligible entries left to draw.");
  const entry = pool[randomInt(pool.length)];
  const ts = nowIso();
  const draw: LuckyDrawDraw = {
    draw_id: newId("drw"),
    entry_id: entry.entry_id,
    participant_id: entry.participant_id,
    prize: prizeName,
    status: "SELECTED",
    redraw_reason: null,
    selected_by: actor.user_id,
    selected_at: ts,
    created_at: ts,
    updated_at: ts,
  };
  await ctx.repo.putDraw(draw);
  return draw;
}

export async function markWinner(ctx: AppContext, drawId: string) {
  try {
    return await ctx.repo.updateDraw(drawId, { status: "WINNER" }, "SELECTED");
  } catch (e) {
    if (e instanceof ConditionFailedError) throw conflict("DRAW_NOT_SELECTED", "Only a freshly selected entry can be confirmed as winner.");
    throw e;
  }
}

export async function setDrawPrize(ctx: AppContext, drawId: string, prize: unknown) {
  const p = typeof prize === "string" ? prize.trim().slice(0, 120) : "";
  if (!p) throw badRequest("PRIZE_REQUIRED", "Enter the prize.");
  const draws = await ctx.repo.listDraws();
  const d = draws.find((x) => x.draw_id === drawId);
  if (!d) throw notFound("DRAW_NOT_FOUND", "Draw not found");
  if (d.status === "REDRAWN") throw conflict("DRAW_REDRAWN", "This draw was redrawn.");
  return ctx.repo.updateDraw(drawId, { prize: p });
}

/** Voids a selection (e.g. unreachable winner) and draws again for the same prize. */
export async function redraw(ctx: AppContext, actor: Actor, drawId: string, reason: unknown) {
  const why = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 200) : "Redraw requested by admin";
  const draws = await ctx.repo.listDraws();
  const d = draws.find((x) => x.draw_id === drawId);
  if (!d) throw notFound("DRAW_NOT_FOUND", "Draw not found");
  if (d.status === "REDRAWN") throw conflict("DRAW_REDRAWN", "Already redrawn.");
  try {
    await ctx.repo.updateDraw(drawId, { status: "REDRAWN", redraw_reason: why }, d.status);
  } catch (e) {
    if (e instanceof ConditionFailedError) throw conflict("DRAW_CHANGED", "This draw changed; refresh and try again.");
    throw e;
  }
  return selectWinner(ctx, actor, d.prize);
}
