import { bub } from "@/config/bub";
import { dayKey, localDateToUtcIso } from "@/lib/time";
import type { Coupon, DashboardUser, Participant, Play, Reward, Session, Source, Sponsor } from "@/types";
import type { Repository } from "./repository";

/**
 * DEMO DATA — for local mock mode and staging walkthroughs ONLY.
 *
 * Every demo record is identifiable three ways:
 *   1. its id starts with `demo_` (coupon ids `demo_cpn_…`, Lucky Draw ids BUB-LD-9990xx),
 *   2. `is_demo: true` is stored on the record,
 *   3. human-readable names start with "[DEMO]" (coupon codes start with BUB-DEMX).
 *
 * Contents: 2 sponsors · 3 rewards (with inventory) · 3 QR sources · 5 participants ·
 * 4 coupons (1 redeemed) · 3 Lucky Draw entries · demo dashboard logins.
 *
 * Records are written through the same atomic repository operations the app uses, so all
 * counters (inventory, claimed, redeemed, per-source and campaign totals) are consistent.
 * Never load this into the production table (the seed script refuses tables named *prod*).
 */

export const DEMO_PREFIX = "demo_";
export const DEMO_TAG = "[DEMO]";

export const DEMO_IDS = {
  sponsors: { title: "demo_spn_title", partner: "demo_spn_partner" },
  rewards: { voucher: "demo_rwd_voucher500", offer: "demo_rwd_expo_offer", fallback: "demo_rwd_lucky_entry" },
  sources: ["H001", "N001", "NT001"] as const,
} as const;

export const DEMO_USERS: DashboardUser[] = [
  { user_id: "demo_user_admin", email: "admin@demo.bub.local", role: "ADMIN", sponsor_id: null, is_demo: true, created_at: "", updated_at: "" },
  { user_id: "demo_user_title", email: "title-sponsor@demo.bub.local", role: "SPONSOR", sponsor_id: DEMO_IDS.sponsors.title, is_demo: true, created_at: "", updated_at: "" },
  { user_id: "demo_user_partner", email: "partner@demo.bub.local", role: "SPONSOR", sponsor_id: DEMO_IDS.sponsors.partner, is_demo: true, created_at: "", updated_at: "" },
];

interface DemoPerson {
  n: number;
  name: string;
  phone: string;
  source: (typeof DEMO_IDS.sources)[number];
  reward: keyof typeof DEMO_IDS.rewards;
  coupon: string | null;
  redeemed: boolean;
  luckyDraw: string | null;
}

export const DEMO_PARTICIPANTS: DemoPerson[] = [
  { n: 1, name: "[DEMO] Asha", phone: "+919000000001", source: "H001", reward: "voucher", coupon: "BUB-DEMXA2", redeemed: true, luckyDraw: "BUB-LD-999001" },
  { n: 2, name: "[DEMO] Karthik", phone: "+919000000002", source: "H001", reward: "offer", coupon: "BUB-DEMXB3", redeemed: false, luckyDraw: "BUB-LD-999002" },
  { n: 3, name: "[DEMO] Meena", phone: "+919000000003", source: "N001", reward: "voucher", coupon: "BUB-DEMXC4", redeemed: false, luckyDraw: "BUB-LD-999003" },
  { n: 4, name: "[DEMO] Ravi", phone: "+919000000004", source: "N001", reward: "offer", coupon: "BUB-DEMXD5", redeemed: false, luckyDraw: null },
  { n: 5, name: "[DEMO] Divya", phone: "+919000000005", source: "NT001", reward: "fallback", coupon: null, redeemed: false, luckyDraw: null },
];

export function isDemoId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(DEMO_PREFIX);
}

export async function seedDemo(repo: Repository, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const ts = now.toISOString();
  const off = bub.event.utcOffsetMinutes;
  const eventStart = localDateToUtcIso(bub.event.startDate, "start", off);
  const eventEnd = localDateToUtcIso(bub.event.endDate, "end", off);

  if (await repo.getSponsor(DEMO_IDS.sponsors.title)) return; // already seeded

  // ---- sources (3) ----
  const sources: Array<Pick<Source, "source_id" | "type" | "name" | "location">> = [
    { source_id: "H001", type: "HOARDING", name: `${DEMO_TAG} Hoarding 1`, location: "Salem Junction (demo)" },
    { source_id: "N001", type: "NEWSPAPER", name: `${DEMO_TAG} Newspaper`, location: "Print — edition 1 (demo)" },
    { source_id: "NT001", type: "NOTICE", name: `${DEMO_TAG} Notice`, location: "College notice board (demo)" },
  ];
  for (const s of sources) {
    if (!(await repo.getSource(s.source_id))) await repo.createSource({ ...s, active: true, scans: 0, sessions: 0, plays: 0, leads: 0, rewards: 0, is_demo: true, created_at: ts, updated_at: ts });
  }

  // ---- sponsors (2) ----
  const sponsors: Sponsor[] = [
    { sponsor_id: DEMO_IDS.sponsors.title, name: `${DEMO_TAG} Title Sponsor`, logo_url: null, instagram_url: null, is_title_sponsor: true, active: true, is_demo: true, created_at: ts, updated_at: ts },
    { sponsor_id: DEMO_IDS.sponsors.partner, name: `${DEMO_TAG} Expo Partner`, logo_url: null, instagram_url: null, is_title_sponsor: false, active: true, is_demo: true, created_at: ts, updated_at: ts },
  ];
  for (const s of sponsors) await repo.createSponsor(s);

  // ---- rewards (3) with inventory ----
  const common = { claimed_count: 0, redeemed_count: 0, active: true, valid_from: null, valid_until: eventEnd, redeem_from: eventStart, redeem_until: eventEnd, is_demo: true, created_at: ts, updated_at: ts };
  const rewards: Reward[] = [
    { ...common, reward_id: DEMO_IDS.rewards.voucher, sponsor_id: DEMO_IDS.sponsors.partner, name: `${DEMO_TAG} ₹500 Voucher`, description: "Demo voucher — redeem at the partner stall.", type: "VOUCHER", total_limit: 100, daily_limit: 20, remaining_inventory: 100, fallback: false, weight: 1 },
    { ...common, reward_id: DEMO_IDS.rewards.offer, sponsor_id: DEMO_IDS.sponsors.title, name: `${DEMO_TAG} Special Expo Offer`, description: "Demo expo-only offer from the title sponsor.", type: "OFFER", total_limit: 200, daily_limit: 60, remaining_inventory: 200, fallback: false, weight: 1 },
    { ...common, reward_id: DEMO_IDS.rewards.fallback, sponsor_id: DEMO_IDS.sponsors.title, name: `${DEMO_TAG} Lucky Draw Entry`, description: "Every player gets a shot at the BUB Lucky Draw.", type: "ENTRY_ONLY", total_limit: null, daily_limit: null, remaining_inventory: null, fallback: true, weight: 1, redeem_from: null, redeem_until: null },
  ];
  for (const r of rewards) await repo.createReward(r);
  const rewardById = new Map(rewards.map((r) => [r.reward_id, r]));

  // ---- 5 participants, their plays, claims, coupons, redemptions and Lucky Draw entries ----
  const dk = dayKey(now, bub.event.timezone);
  for (const p of DEMO_PARTICIPANTS) {
    const at = new Date(now.getTime() - (6 - p.n) * 3600_000).toISOString();
    const sessionId = `demo_ses_${p.n}`.padEnd(32, "0");
    const session: Session = { session_id: sessionId, source_id: p.source, src_raw: null, play_id: null, participant_id: null, verified_phone: null, pending_name: p.name, pending_phone: p.phone, game_started_at: at, is_demo: true, created_at: at, updated_at: at };
    await repo.createSession(session);
    const src = (await repo.getSource(p.source))!;
    await repo.recordSourceVisit({ visit_id: `demo_vst_${p.n}`, source_id: src.source_id, source_type: src.type, location: src.location, session_id: sessionId, new_session: true, is_demo: true, created_at: at });
    for (const k of ["qr_scans", "unique_sessions", "games_started", "game_plays"] as const) await repo.incrementStat(k);
    for (const k of ["scans", "sessions", "plays"] as const) await repo.incrementSourceCounter(p.source, k);

    const reward = rewardById.get(DEMO_IDS.rewards[p.reward])!;
    const play: Play = { play_id: `demo_ply_${p.n}`, session_id: sessionId, source_id: p.source, box_index: p.n % 3, reward_id: reward.reward_id, sponsor_id: reward.sponsor_id, coupon_code: p.coupon, status: "HELD", day_key: dk, hold_expires_at: new Date(now.getTime() + 3600_000).toISOString(), participant_id: null, is_demo: true, created_at: at, updated_at: at };
    const coupon: Coupon | null = p.coupon
      ? { coupon_id: `demo_cpn_${p.n}`, coupon_code: p.coupon, participant_id: null, play_id: play.play_id, sponsor_id: reward.sponsor_id, reward_id: reward.reward_id, status: "ISSUED", issued_at: at, claimed_at: null, redeemed_at: null, redeemed_by: null, valid_from: reward.redeem_from, valid_until: reward.redeem_until, is_demo: true, created_at: at, updated_at: at }
      : null;
    await repo.holdReward({ play, coupon, reward: (await repo.getReward(reward.reward_id))!, dayKey: dk });

    const participant: Participant = {
      participant_id: `demo_par_${p.n}`, name: p.name, phone: p.phone, source_id: p.source, session_id: sessionId, whatsapp_verified: true, verified_at: at,
      play_id: null, reward_id: null, coupon_code: null, followed_bub_confirmed: false, followed_organizer_confirmed: false, followed_sponsor_confirmed: false,
      lucky_draw_eligible: false, lucky_draw_entry_id: null, entered_at: null, is_demo: true, created_at: at, updated_at: at,
    };
    await repo.createParticipant(participant);
    await repo.updateSession(sessionId, { verified_phone: p.phone, participant_id: participant.participant_id });
    await repo.incrementStat("verified_participants");
    await repo.incrementSourceCounter(p.source, "leads");

    await repo.claimReward({ play, participantId: participant.participant_id, phone: p.phone, now: at });
    await repo.incrementStat("rewards_won");
    await repo.incrementSourceCounter(p.source, "rewards");
    if (coupon) await repo.incrementStat("coupons_issued");

    if (p.coupon && p.redeemed) {
      await repo.redeemCoupon(p.coupon, "demo_user_admin", ts);
      await repo.incrementStat("coupons_redeemed");
    }
    if (p.luckyDraw) {
      await repo.createLuckyDrawEntry(
        { entry_id: p.luckyDraw, participant_id: participant.participant_id, source_id: p.source, is_demo: true, entered_at: at, created_at: at },
        { followed_bub_confirmed: true, followed_organizer_confirmed: true, followed_sponsor_confirmed: true, lucky_draw_eligible: true, entered_at: at },
      );
      await repo.incrementStat("lucky_draw_entries");
    }
  }

  for (const u of DEMO_USERS) await repo.putDashboardUser({ ...u, created_at: ts, updated_at: ts });
}
