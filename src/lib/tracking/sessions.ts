import type { AppContext } from "@/lib/context";
import { newId, newSessionId } from "@/lib/ids";
import { notFound } from "@/lib/errors";
import { nowIso } from "@/lib/time";
import { maskPhone } from "@/lib/phone";
import type { Session, Source } from "@/types";
import { publicPlayView, type PublicPlayView } from "@/lib/rewards/engine";

const SRC_PATTERN = /^[A-Z0-9_-]{1,24}$/;

/** Uppercases and validates a raw ?src value. Returns null for anything malformed. */
export function sanitizeSourceId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  return SRC_PATTERN.test(v) ? v : null;
}

/** Resolves ?src to an ACTIVE source, or null (direct / unknown / inactive). */
export async function resolveSource(ctx: AppContext, raw: unknown): Promise<{ source: Source | null; srcRaw: string | null }> {
  const id = sanitizeSourceId(raw);
  if (!id) return { source: null, srcRaw: null };
  const source = await ctx.repo.getSource(id);
  if (!source || !source.active) return { source: null, srcRaw: id };
  return { source, srcRaw: null };
}

export type SessionEvent = "visit" | "game_started";

export interface SessionState {
  session_id: string;
  source: { source_id: string; type: string; name: string } | null;
  play: PublicPlayView | null;
  verified: boolean;
  participant: {
    first_name: string;
    phone_masked: string;
    coupon_code: string | null;
    reward_claimed: boolean;
    lucky_draw_entry_id: string | null;
  } | null;
  mock_mode: { whatsapp: boolean; aws: boolean };
  campaign_status: "live" | "paused" | "ended";
}

/**
 * POST /api/session
 * - No session_id (or unknown): creates a session (unique session) attributed to ?src.
 * - event "visit" with a valid src counts one QR Scan (a visit through a QR link — not physical reach).
 * - event "game_started" marks the game as started (counted once per session).
 * Returns the resumable state of the public flow.
 */
export async function touchSession(
  ctx: AppContext,
  input: { session_id?: string | null; src?: string | null; event?: SessionEvent },
): Promise<SessionState> {
  const { repo } = ctx;
  let session = input.session_id ? await repo.getSession(input.session_id) : null;
  const { source, srcRaw } = await resolveSource(ctx, input.src);

  let isNewSession = false;
  if (!session) {
    isNewSession = true;
    const ts = nowIso();
    session = {
      session_id: newSessionId(),
      source_id: source?.source_id ?? null,
      src_raw: srcRaw,
      play_id: null,
      participant_id: null,
      verified_phone: null,
      pending_name: null,
      pending_phone: null,
      game_started_at: null,
      created_at: ts,
      updated_at: ts,
    };
    await repo.createSession(session);
    await repo.incrementStat("unique_sessions");
    if (session.source_id) await repo.incrementSourceCounter(session.source_id, "sessions");
  }

  if (input.event === "visit" && source) {
    // First-touch attribution stays on the session; every QR visit still counts for the scanned source.
    // Recorded as an actual visit (source, type, location, timestamp, session) — not "reach".
    await repo.recordSourceVisit({
      visit_id: newId("vst"),
      source_id: source.source_id,
      source_type: source.type,
      location: source.location,
      session_id: session.session_id,
      new_session: isNewSession,
      created_at: nowIso(),
    });
    await repo.incrementStat("qr_scans");
    await repo.incrementSourceCounter(source.source_id, "scans");
  }

  if (input.event === "game_started" && !session.game_started_at) {
    session = await repo.updateSession(session.session_id, { game_started_at: nowIso() });
    await repo.incrementStat("games_started");
  }

  return buildSessionState(ctx, session);
}

export async function requireSession(ctx: AppContext, sessionId: unknown): Promise<Session> {
  if (typeof sessionId !== "string" || !/^[a-f0-9]{32}$/.test(sessionId)) throw notFound("SESSION_NOT_FOUND", "Your session has expired. Please start again.");
  const s = await ctx.repo.getSession(sessionId);
  if (!s) throw notFound("SESSION_NOT_FOUND", "Your session has expired. Please start again.");
  return s;
}

export async function buildSessionState(ctx: AppContext, session: Session): Promise<SessionState> {
  const { repo } = ctx;
  const source = session.source_id ? await repo.getSource(session.source_id) : null;
  const play = session.play_id ? await repo.getPlay(session.play_id) : null;
  const participant = session.participant_id ? await repo.getParticipant(session.participant_id) : null;
  const lock = participant ? await repo.getPhoneLock(participant.phone) : null;
  return {
    session_id: session.session_id,
    source: source ? { source_id: source.source_id, type: source.type, name: source.name } : null,
    play: play ? await publicPlayView(ctx, play) : null,
    verified: Boolean(session.verified_phone),
    participant: participant
      ? {
          first_name: participant.name.split(" ")[0],
          phone_masked: maskPhone(participant.phone),
          coupon_code: participant.coupon_code,
          reward_claimed: Boolean(lock?.reward_claimed),
          lucky_draw_entry_id: participant.lucky_draw_entry_id,
        }
      : null,
    mock_mode: { whatsapp: ctx.cfg.whatsappMockMode, aws: ctx.cfg.awsMockMode },
    campaign_status: ctx.cfg.campaignStatus,
  };
}
