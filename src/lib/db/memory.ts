import { ConditionFailedError, notFound } from "@/lib/errors";
import { now as clockNow } from "@/lib/time";
import type {
  CampaignStats,
  Coupon,
  CouponStatus,
  DashboardUser,
  LuckyDrawDraw,
  LuckyDrawEntry,
  Participant,
  Play,
  Reward,
  Session,
  Source,
  SourceCounter,
  Sponsor,
  StatKey,
  StoryGeneration,
  StoryTemplate,
  SourceVisit,
} from "@/types";
import type { ClaimInput, HoldRewardInput, OtpRecord, PhoneLock, RateLimitResult, ReleaseHoldInput, Repository } from "./repository";

const clone = <T>(v: T): T => structuredClone(v);

/**
 * Yield to the event loop before each critical section so concurrent callers genuinely
 * interleave (this is what makes the concurrency tests meaningful). Each critical section
 * after the yield is fully synchronous, which makes it atomic in a single Node process —
 * the in-memory analogue of a DynamoDB transaction.
 */
const yieldTick = () => new Promise<void>((r) => setImmediate(r));

export function emptyStats(): CampaignStats {
  return {
    qr_scans: 0,
    unique_sessions: 0,
    games_started: 0,
    game_plays: 0,
    verified_participants: 0,
    rewards_won: 0,
    coupons_issued: 0,
    coupons_redeemed: 0,
    lucky_draw_entries: 0,
    stories_generated: 0,
  };
}

export class MemoryRepository implements Repository {
  stats: CampaignStats = emptyStats();
  sources = new Map<string, Source>();
  sponsors = new Map<string, Sponsor>();
  rewards = new Map<string, Reward>();
  daily = new Map<string, number>(); // `${rewardId}#${dayKey}`
  sessions = new Map<string, Session>();
  plays = new Map<string, Play>();
  participants = new Map<string, Participant>();
  phoneLocks = new Map<string, PhoneLock>();
  otps = new Map<string, OtpRecord>();
  coupons = new Map<string, Coupon>();
  entries = new Map<string, LuckyDrawEntry>();
  draws = new Map<string, LuckyDrawDraw>();
  templates = new Map<string, StoryTemplate>();
  generations = new Map<string, StoryGeneration>();
  users = new Map<string, DashboardUser>();
  rate = new Map<string, { count: number; windowStart: number }>();
  visits: SourceVisit[] = [];

  // ---------- stats ----------
  async incrementStat(key: StatKey, by = 1) {
    this.stats[key] += by;
  }
  async getStats() {
    return clone(this.stats);
  }

  // ---------- sources ----------
  async getSource(id: string) {
    const s = this.sources.get(id);
    return s ? clone(s) : null;
  }
  async listSources() {
    return [...this.sources.values()].map(clone).sort((a, b) => a.source_id.localeCompare(b.source_id));
  }
  async createSource(source: Source) {
    await yieldTick();
    if (this.sources.has(source.source_id)) throw new ConditionFailedError("SOURCE_EXISTS");
    this.sources.set(source.source_id, clone(source));
  }
  async updateSource(id: string, patch: Partial<Source>) {
    const s = this.sources.get(id);
    if (!s) throw notFound("SOURCE_NOT_FOUND", "Source not found");
    Object.assign(s, clone(patch), { updated_at: clockNow().toISOString() });
    return clone(s);
  }
  async incrementSourceCounter(id: string, counter: SourceCounter, by = 1) {
    const s = this.sources.get(id);
    if (s) s[counter] += by;
  }

  async recordSourceVisit(v: SourceVisit) {
    this.visits.push(clone(v));
  }
  async listSourceVisits(sourceId: string, limit: number) {
    return this.visits.filter((v) => v.source_id === sourceId).slice(-limit).reverse().map(clone);
  }

  // ---------- sponsors ----------
  async getSponsor(id: string) {
    const s = this.sponsors.get(id);
    return s ? clone(s) : null;
  }
  async listSponsors() {
    return [...this.sponsors.values()].map(clone).sort((a, b) => a.name.localeCompare(b.name));
  }
  async createSponsor(sponsor: Sponsor) {
    if (this.sponsors.has(sponsor.sponsor_id)) throw new ConditionFailedError("SPONSOR_EXISTS");
    this.sponsors.set(sponsor.sponsor_id, clone(sponsor));
  }
  async updateSponsor(id: string, patch: Partial<Sponsor>) {
    const s = this.sponsors.get(id);
    if (!s) throw notFound("SPONSOR_NOT_FOUND", "Sponsor not found");
    Object.assign(s, clone(patch), { updated_at: clockNow().toISOString() });
    return clone(s);
  }

  // ---------- rewards ----------
  async getReward(id: string) {
    const r = this.rewards.get(id);
    return r ? clone(r) : null;
  }
  async listRewards() {
    return [...this.rewards.values()].map(clone).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async listRewardsBySponsor(sponsorId: string) {
    return (await this.listRewards()).filter((r) => r.sponsor_id === sponsorId);
  }
  async createReward(reward: Reward) {
    if (this.rewards.has(reward.reward_id)) throw new ConditionFailedError("REWARD_EXISTS");
    this.rewards.set(reward.reward_id, clone(reward));
  }
  async updateReward(id: string, patch: Partial<Reward>, totalDelta = 0) {
    await yieldTick();
    const r = this.rewards.get(id);
    if (!r) throw notFound("REWARD_NOT_FOUND", "Reward not found");
    if (totalDelta !== 0) {
      if (r.total_limit === null || r.remaining_inventory === null) throw new ConditionFailedError("UNLIMITED_REWARD");
      if (r.remaining_inventory + totalDelta < 0) throw new ConditionFailedError("INVENTORY_BELOW_ZERO");
      r.total_limit += totalDelta;
      r.remaining_inventory += totalDelta;
    }
    Object.assign(r, clone(patch), { updated_at: clockNow().toISOString() });
    return clone(r);
  }
  async getDailyCount(rewardId: string, dayKey: string) {
    return this.daily.get(`${rewardId}#${dayKey}`) ?? 0;
  }

  // ---------- sessions ----------
  async createSession(session: Session) {
    if (this.sessions.has(session.session_id)) throw new ConditionFailedError("SESSION_EXISTS");
    this.sessions.set(session.session_id, clone(session));
  }
  async getSession(id: string) {
    const s = this.sessions.get(id);
    return s ? clone(s) : null;
  }
  async updateSession(id: string, patch: Partial<Session>) {
    const s = this.sessions.get(id);
    if (!s) throw notFound("SESSION_NOT_FOUND", "Session not found");
    Object.assign(s, clone(patch), { updated_at: clockNow().toISOString() });
    return clone(s);
  }

  // ---------- plays / allocation ----------
  async getPlay(id: string) {
    const p = this.plays.get(id);
    return p ? clone(p) : null;
  }

  async holdReward({ play, coupon, reward, dayKey }: HoldRewardInput) {
    await yieldTick();
    // ---- critical section (synchronous) ----
    const r = this.rewards.get(reward.reward_id);
    const session = this.sessions.get(play.session_id);
    if (!session) throw new ConditionFailedError("SESSION_ALREADY_PLAYED");
    if (session.play_id) throw new ConditionFailedError("SESSION_ALREADY_PLAYED");
    if (!r || !r.active) throw new ConditionFailedError("REWARD_INACTIVE");
    if (r.remaining_inventory !== null && r.remaining_inventory <= 0) throw new ConditionFailedError("INVENTORY");
    const dk = `${r.reward_id}#${dayKey}`;
    const used = this.daily.get(dk) ?? 0;
    if (r.daily_limit !== null && used >= r.daily_limit) throw new ConditionFailedError("DAILY_LIMIT");
    if (coupon && this.coupons.has(coupon.coupon_code)) throw new ConditionFailedError("COUPON_CODE_COLLISION");

    if (r.remaining_inventory !== null) r.remaining_inventory -= 1;
    if (r.daily_limit !== null) this.daily.set(dk, used + 1);
    this.plays.set(play.play_id, clone(play));
    if (coupon) this.coupons.set(coupon.coupon_code, clone(coupon));
    session.play_id = play.play_id;
    session.updated_at = play.created_at;
  }

  async recordEmptyPlay(play: Play) {
    await yieldTick();
    const session = this.sessions.get(play.session_id);
    if (!session || session.play_id) throw new ConditionFailedError("SESSION_ALREADY_PLAYED");
    this.plays.set(play.play_id, clone(play));
    session.play_id = play.play_id;
  }

  async claimReward({ play, participantId, phone, now }: ClaimInput) {
    await yieldTick();
    // ---- critical section (synchronous) ----
    const lock = this.phoneLocks.get(phone);
    if (!lock || lock.reward_claimed) throw new ConditionFailedError("PHONE_ALREADY_CLAIMED");
    const p = this.plays.get(play.play_id);
    const claimable = p && (p.status === "HELD" || (p.status === "NO_REWARD" && !p.participant_id));
    if (!p || !claimable) throw new ConditionFailedError("PLAY_NOT_HELD");
    const coupon = p.coupon_code ? this.coupons.get(p.coupon_code) : undefined;
    if (p.coupon_code && (!coupon || coupon.status !== "ISSUED")) throw new ConditionFailedError("COUPON_NOT_ISSUED");

    lock.reward_claimed = true;
    lock.play_id = p.play_id;
    lock.updated_at = now;
    if (p.status === "HELD") p.status = "CLAIMED";
    p.participant_id = participantId;
    p.hold_expires_at = null;
    p.updated_at = now;
    if (p.reward_id) {
      const r = this.rewards.get(p.reward_id);
      if (r) r.claimed_count += 1;
    }
    if (coupon) {
      coupon.status = "CLAIMED";
      coupon.participant_id = participantId;
      coupon.claimed_at = now;
      coupon.updated_at = now;
    }
    const part = this.participants.get(participantId);
    if (part) {
      part.play_id = p.play_id;
      part.reward_id = p.reward_id;
      part.coupon_code = p.coupon_code;
      part.updated_at = now;
    }
  }

  async releaseHold({ play, now, force }: ReleaseHoldInput) {
    await yieldTick();
    const p = this.plays.get(play.play_id);
    if (!p || p.status !== "HELD" || (!force && (!p.hold_expires_at || p.hold_expires_at > now))) {
      throw new ConditionFailedError("NOT_EXPIRED_HOLD");
    }
    p.status = "EXPIRED";
    p.updated_at = now;
    const r = p.reward_id ? this.rewards.get(p.reward_id) : undefined;
    if (r) {
      if (r.remaining_inventory !== null) r.remaining_inventory += 1;
      if (r.daily_limit !== null) {
        const dk = `${r.reward_id}#${p.day_key}`;
        this.daily.set(dk, Math.max(0, (this.daily.get(dk) ?? 0) - 1));
      }
    }
    if (p.coupon_code) {
      const c = this.coupons.get(p.coupon_code);
      if (c && c.status === "ISSUED") {
        c.status = "CANCELLED";
        c.updated_at = now;
      }
    }
  }

  async listExpiredHolds(nowIso: string, limit: number) {
    return [...this.plays.values()]
      .filter((p) => p.status === "HELD" && p.hold_expires_at !== null && p.hold_expires_at <= nowIso)
      .slice(0, limit)
      .map(clone);
  }

  async listPlays() {
    return [...this.plays.values()].map(clone);
  }

  // ---------- participants ----------
  async getParticipant(id: string) {
    const p = this.participants.get(id);
    return p ? clone(p) : null;
  }
  async getPhoneLock(phone: string) {
    const l = this.phoneLocks.get(phone);
    return l ? clone(l) : null;
  }
  async createParticipant(participant: Participant) {
    await yieldTick();
    if (this.phoneLocks.has(participant.phone)) throw new ConditionFailedError("PHONE_EXISTS");
    this.participants.set(participant.participant_id, clone(participant));
    this.phoneLocks.set(participant.phone, {
      phone: participant.phone,
      participant_id: participant.participant_id,
      reward_claimed: false,
      play_id: null,
      created_at: participant.created_at,
      updated_at: participant.created_at,
    });
  }
  async updateParticipant(id: string, patch: Partial<Participant>) {
    const p = this.participants.get(id);
    if (!p) throw notFound("PARTICIPANT_NOT_FOUND", "Participant not found");
    Object.assign(p, clone(patch), { updated_at: clockNow().toISOString() });
    return clone(p);
  }
  async listParticipants() {
    return [...this.participants.values()].map(clone).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  // ---------- OTP ----------
  async getOtp(phone: string) {
    const o = this.otps.get(phone);
    return o ? clone(o) : null;
  }
  async putOtp(record: OtpRecord) {
    this.otps.set(record.phone, clone(record));
  }
  async incrementOtpAttempts(phone: string) {
    const o = this.otps.get(phone);
    if (!o) return Number.MAX_SAFE_INTEGER;
    o.attempts += 1;
    return o.attempts;
  }
  async deleteOtp(phone: string) {
    this.otps.delete(phone);
  }

  // ---------- coupons ----------
  async getCoupon(code: string) {
    const c = this.coupons.get(code);
    return c ? clone(c) : null;
  }
  async listCoupons() {
    return [...this.coupons.values()].map(clone).sort((a, b) => b.issued_at.localeCompare(a.issued_at));
  }
  async listCouponsBySponsor(sponsorId: string) {
    return (await this.listCoupons()).filter((c) => c.sponsor_id === sponsorId);
  }
  async redeemCoupon(code: string, redeemedBy: string, now: string) {
    await yieldTick();
    const c = this.coupons.get(code);
    if (!c || c.status !== "CLAIMED") throw new ConditionFailedError("NOT_REDEEMABLE");
    c.status = "REDEEMED";
    c.redeemed_at = now;
    c.redeemed_by = redeemedBy;
    c.updated_at = now;
    const r = this.rewards.get(c.reward_id);
    if (r) r.redeemed_count += 1;
    return clone(c);
  }
  async setCouponStatus(code: string, from: CouponStatus[], to: CouponStatus, now: string) {
    await yieldTick();
    const c = this.coupons.get(code);
    if (!c || !from.includes(c.status)) throw new ConditionFailedError("STATUS_MISMATCH");
    c.status = to;
    c.updated_at = now;
    return clone(c);
  }

  // ---------- lucky draw ----------
  async createLuckyDrawEntry(entry: LuckyDrawEntry, participantPatch: Partial<Participant>) {
    await yieldTick();
    const p = this.participants.get(entry.participant_id);
    if (!p) throw notFound("PARTICIPANT_NOT_FOUND", "Participant not found");
    if (p.lucky_draw_entry_id) throw new ConditionFailedError("ALREADY_ENTERED");
    if (this.entries.has(entry.entry_id)) throw new ConditionFailedError("ENTRY_ID_COLLISION");
    this.entries.set(entry.entry_id, clone(entry));
    Object.assign(p, clone(participantPatch), { lucky_draw_entry_id: entry.entry_id, updated_at: entry.created_at });
  }
  async getLuckyDrawEntry(id: string) {
    const e = this.entries.get(id);
    return e ? clone(e) : null;
  }
  async listLuckyDrawEntries() {
    return [...this.entries.values()].map(clone).sort((a, b) => a.entered_at.localeCompare(b.entered_at));
  }
  async listDraws() {
    return [...this.draws.values()].map(clone).sort((a, b) => a.selected_at.localeCompare(b.selected_at));
  }
  async putDraw(draw: LuckyDrawDraw) {
    this.draws.set(draw.draw_id, clone(draw));
  }
  async updateDraw(id: string, patch: Partial<LuckyDrawDraw>, expectedStatus?: LuckyDrawDraw["status"]) {
    await yieldTick();
    const d = this.draws.get(id);
    if (!d) throw notFound("DRAW_NOT_FOUND", "Draw not found");
    if (expectedStatus && d.status !== expectedStatus) throw new ConditionFailedError("DRAW_STATUS_CHANGED");
    Object.assign(d, clone(patch), { updated_at: clockNow().toISOString() });
    return clone(d);
  }

  // ---------- story ----------
  async listStoryTemplates() {
    return [...this.templates.values()].map(clone).sort((a, b) => a.sort_order - b.sort_order);
  }
  async getStoryTemplate(id: string) {
    const t = this.templates.get(id);
    return t ? clone(t) : null;
  }
  async putStoryTemplate(t: StoryTemplate) {
    this.templates.set(t.template_id, clone(t));
  }
  async recordStoryGeneration(gen: StoryGeneration) {
    this.generations.set(gen.generation_id, clone(gen));
  }

  // ---------- users ----------
  async getDashboardUser(id: string) {
    const u = this.users.get(id);
    return u ? clone(u) : null;
  }
  async putDashboardUser(u: DashboardUser) {
    this.users.set(u.user_id, clone(u));
  }
  async listDashboardUsers() {
    return [...this.users.values()].map(clone);
  }

  // ---------- rate limit (fixed window) ----------
  async hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const nowMs = clockNow().getTime();
    const windowMs = windowSeconds * 1000;
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const cur = this.rate.get(key);
    const entry = cur && cur.windowStart === windowStart ? cur : { count: 0, windowStart };
    entry.count += 1;
    this.rate.set(key, entry);
    if (this.rate.size > 50_000) {
      for (const [k, v] of this.rate) if (v.windowStart < windowStart) this.rate.delete(k);
    }
    const allowed = entry.count <= limit;
    return { allowed, count: entry.count, retryAfterSeconds: allowed ? 0 : Math.ceil((windowStart + windowMs - nowMs) / 1000) };
  }
}
