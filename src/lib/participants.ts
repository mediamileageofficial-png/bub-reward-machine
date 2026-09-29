import type { AppContext } from "@/lib/context";
import { AppError, ConditionFailedError, badRequest } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { maskPhone, normalizePhone, phoneCountry } from "@/lib/phone";
import { nowIso } from "@/lib/time";
import type { Participant, Session } from "@/types";

const NAME_PATTERN = /^[\p{L}\p{M} .'-]{1,60}$/u;

export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") throw badRequest("INVALID_NAME", "Please enter your name.");
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name || !NAME_PATTERN.test(name)) throw badRequest("INVALID_NAME", "Please enter your name using letters only.");
  return name;
}

export function requirePhone(ctx: AppContext, raw: unknown): string {
  const phone = typeof raw === "string" ? normalizePhone(raw, ctx.cfg.defaultCountry) : null;
  if (!phone) throw badRequest("INVALID_PHONE", "Enter a valid WhatsApp mobile number.");
  const allowed = ctx.cfg.whatsapp.allowedCountries;
  if (allowed.length && !allowed.includes(phoneCountry(phone) ?? "")) {
    throw badRequest("PHONE_COUNTRY_NOT_SUPPORTED", "WhatsApp numbers from this country aren't supported for this campaign.");
  }
  return phone;
}

/** POST /api/participant — records name + number on the session (unverified). Only name and number are collected. */
export async function registerParticipant(ctx: AppContext, session: Session, input: { name: unknown; phone: unknown }) {
  const name = cleanName(input.name);
  const phone = requirePhone(ctx, input.phone);
  if (session.verified_phone && session.verified_phone !== phone) {
    throw badRequest("SESSION_ALREADY_VERIFIED", "This session is already verified with another number.");
  }
  await ctx.repo.updateSession(session.session_id, { pending_name: name, pending_phone: phone });
  return { phone_masked: maskPhone(phone), name };
}

/** POST /api/otp/send */
export async function sendOtp(ctx: AppContext, session: Session) {
  if (!session.pending_phone) throw badRequest("DETAILS_REQUIRED", "Enter your name and WhatsApp number first.");
  const outcome = await ctx.whatsapp.sendOTP(session.pending_phone);
  return {
    phone_masked: maskPhone(session.pending_phone),
    // Honest status: MOCKED (nothing sent) or ACCEPTED (provider accepted it). Never "delivered".
    send_status: outcome.result.status,
    mock: outcome.mock,
    mock_hint: outcome.mock ? `Demo mode: no WhatsApp message was sent. Use code ${ctx.cfg.otp.mockCode}.` : undefined,
    resend_after_seconds: outcome.resendAfterSeconds,
    expires_in_seconds: outcome.expiresInSeconds,
  };
}

/**
 * POST /api/otp/verify — on success the session becomes verified and is linked to exactly one
 * participant per phone number (created on first verification).
 */
export async function verifyOtp(ctx: AppContext, session: Session, code: unknown) {
  const { repo } = ctx;
  if (!session.pending_phone || !session.pending_name) throw badRequest("DETAILS_REQUIRED", "Enter your name and WhatsApp number first.");
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) throw badRequest("INVALID_CODE", "Enter the 6-digit code.");

  const phone = session.pending_phone;
  const ok = await ctx.whatsapp.verifyOTP(phone, code);
  if (!ok) throw new AppError(400, "WRONG_CODE", "That code didn't match or has expired. Try again or request a new code.");

  let participant = await findParticipantByPhone(ctx, phone);
  let isNew = false;
  if (!participant) {
    const ts = nowIso();
    const fresh: Participant = {
      participant_id: newId("par"),
      name: session.pending_name,
      phone,
      source_id: session.source_id,
      session_id: session.session_id,
      whatsapp_verified: true,
      verified_at: ts,
      play_id: null,
      reward_id: null,
      coupon_code: null,
      followed_bub_confirmed: false,
      followed_organizer_confirmed: false,
      followed_sponsor_confirmed: false,
      lucky_draw_eligible: false,
      lucky_draw_entry_id: null,
      entered_at: null,
      created_at: ts,
      updated_at: ts,
    };
    try {
      await repo.createParticipant(fresh);
      participant = fresh;
      isNew = true;
    } catch (e) {
      if (!(e instanceof ConditionFailedError && e.reason === "PHONE_EXISTS")) throw e;
      participant = await findParticipantByPhone(ctx, phone); // lost a race with another session for the same number
    }
  }
  if (!participant) throw new AppError(500, "PARTICIPANT_ERROR", "Something went wrong. Please try again.");

  await repo.updateSession(session.session_id, { verified_phone: phone, participant_id: participant.participant_id });
  if (isNew) {
    await repo.incrementStat("verified_participants");
    if (participant.source_id) await repo.incrementSourceCounter(participant.source_id, "leads");
  }
  const lock = await repo.getPhoneLock(phone);
  return {
    verified: true,
    first_name: participant.name.split(" ")[0],
    already_played: Boolean(lock?.reward_claimed),
    existing_coupon_code: lock?.reward_claimed ? participant.coupon_code : null,
  };
}

export async function findParticipantByPhone(ctx: AppContext, phone: string): Promise<Participant | null> {
  const lock = await ctx.repo.getPhoneLock(phone);
  return lock ? ctx.repo.getParticipant(lock.participant_id) : null;
}
