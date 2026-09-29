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

/**
 * Persistence boundary. Two implementations:
 *  - MemoryRepository  (AWS_MOCK_MODE=true, local dev + tests)
 *  - DynamoRepository  (production, single-table DynamoDB)
 *
 * Every method that protects an invariant (inventory, one-play-per-number, unique codes,
 * one lucky-draw entry) is a single atomic operation here. In DynamoDB these are
 * TransactWriteItems with condition expressions; they throw ConditionFailedError
 * with a `reason` when a condition loses, so the service layer can react.
 */

export interface OtpRecord {
  phone: string;
  code_hash: string;
  attempts: number;
  expires_at: string;
  last_sent_at: string;
  sends_in_window: number;
  window_started_at: string;
}

export interface PhoneLock {
  phone: string;
  participant_id: string;
  reward_claimed: boolean;
  play_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

export interface HoldRewardInput {
  play: Play; // status HELD, reward_id set
  coupon: Coupon | null; // status ISSUED when the reward issues a coupon
  reward: Reward;
  dayKey: string;
}

export interface ClaimInput {
  play: Play;
  participantId: string;
  phone: string;
  now: string;
}

export interface ReleaseHoldInput {
  play: Play;
  reward: Reward | null;
  now: string;
  /** Release even if the hold has not expired yet (e.g. the number already claimed elsewhere). */
  force?: boolean;
}

/** Reasons surfaced by ConditionFailedError. */
export type HoldFailure = "INVENTORY" | "DAILY_LIMIT" | "REWARD_INACTIVE" | "SESSION_ALREADY_PLAYED" | "COUPON_CODE_COLLISION";
export type ClaimFailure = "PHONE_ALREADY_CLAIMED" | "PLAY_NOT_HELD" | "COUPON_NOT_ISSUED";
export type EntryFailure = "ALREADY_ENTERED" | "ENTRY_ID_COLLISION";

export interface Repository {
  // Stats (atomic counters)
  incrementStat(key: StatKey, by?: number): Promise<void>;
  getStats(): Promise<CampaignStats>;

  // Sources
  getSource(sourceId: string): Promise<Source | null>;
  listSources(): Promise<Source[]>;
  createSource(source: Source): Promise<void>; // fails with reason SOURCE_EXISTS
  updateSource(sourceId: string, patch: Partial<Omit<Source, "source_id" | SourceCounter>>): Promise<Source>;
  incrementSourceCounter(sourceId: string, counter: SourceCounter, by?: number): Promise<void>;
  recordSourceVisit(visit: SourceVisit): Promise<void>;
  /** Most recent first. */
  listSourceVisits(sourceId: string, limit: number): Promise<SourceVisit[]>;

  // Sponsors
  getSponsor(sponsorId: string): Promise<Sponsor | null>;
  listSponsors(): Promise<Sponsor[]>;
  createSponsor(sponsor: Sponsor): Promise<void>;
  updateSponsor(sponsorId: string, patch: Partial<Omit<Sponsor, "sponsor_id">>): Promise<Sponsor>;

  // Rewards
  getReward(rewardId: string): Promise<Reward | null>;
  listRewards(): Promise<Reward[]>;
  listRewardsBySponsor(sponsorId: string): Promise<Reward[]>;
  createReward(reward: Reward): Promise<void>;
  /**
   * Admin edit. `totalDelta` atomically adjusts total_limit and remaining_inventory together;
   * fails with reason INVENTORY_BELOW_ZERO if the new total would be below units already held/claimed.
   */
  updateReward(rewardId: string, patch: Partial<Omit<Reward, "reward_id" | "remaining_inventory" | "claimed_count" | "redeemed_count" | "total_limit">>, totalDelta?: number): Promise<Reward>;
  getDailyCount(rewardId: string, dayKey: string): Promise<number>;

  // Sessions
  createSession(session: Session): Promise<void>;
  getSession(sessionId: string): Promise<Session | null>;
  updateSession(sessionId: string, patch: Partial<Omit<Session, "session_id">>): Promise<Session>;

  // Plays + atomic reward allocation
  getPlay(playId: string): Promise<Play | null>;
  /** Atomically: consume 1 unit (and 1 daily unit), write play + ISSUED coupon, bind play to session. */
  holdReward(input: HoldRewardInput): Promise<void>;
  /** Records a play that produced no reward (no inventory and no fallback). Binds play to session. */
  recordEmptyPlay(play: Play): Promise<void>;
  /** Atomically: lock phone as claimed, HELD→CLAIMED, coupon ISSUED→CLAIMED, claimed_count+1, link participant. */
  claimReward(input: ClaimInput): Promise<void>;
  /** Atomically: HELD→EXPIRED, return inventory + daily unit, coupon ISSUED→CANCELLED. */
  releaseHold(input: ReleaseHoldInput): Promise<void>;
  listExpiredHolds(nowIso: string, limit: number): Promise<Play[]>;
  listPlays(): Promise<Play[]>;

  // Participants + phone lock
  getParticipant(participantId: string): Promise<Participant | null>;
  getPhoneLock(phone: string): Promise<PhoneLock | null>;
  /** Creates participant + phone lock together; fails with reason PHONE_EXISTS if the number is already registered. */
  createParticipant(participant: Participant): Promise<void>;
  updateParticipant(participantId: string, patch: Partial<Omit<Participant, "participant_id" | "phone">>): Promise<Participant>;
  listParticipants(): Promise<Participant[]>;

  // OTP
  getOtp(phone: string): Promise<OtpRecord | null>;
  putOtp(record: OtpRecord): Promise<void>;
  incrementOtpAttempts(phone: string): Promise<number>;
  deleteOtp(phone: string): Promise<void>;

  // Coupons
  getCoupon(code: string): Promise<Coupon | null>;
  listCoupons(): Promise<Coupon[]>;
  listCouponsBySponsor(sponsorId: string): Promise<Coupon[]>;
  /** Atomically: CLAIMED→REDEEMED + reward.redeemed_count+1. Fails with reason NOT_REDEEMABLE. */
  redeemCoupon(code: string, redeemedBy: string, now: string): Promise<Coupon>;
  setCouponStatus(code: string, from: CouponStatus[], to: CouponStatus, now: string): Promise<Coupon>;

  // Lucky draw
  /** Atomically: write entry + set participant.lucky_draw_entry_id only if not already set. */
  createLuckyDrawEntry(entry: LuckyDrawEntry, participantPatch: Partial<Participant>): Promise<void>;
  getLuckyDrawEntry(entryId: string): Promise<LuckyDrawEntry | null>;
  listLuckyDrawEntries(): Promise<LuckyDrawEntry[]>;
  listDraws(): Promise<LuckyDrawDraw[]>;
  putDraw(draw: LuckyDrawDraw): Promise<void>;
  updateDraw(drawId: string, patch: Partial<Omit<LuckyDrawDraw, "draw_id">>, expectedStatus?: LuckyDrawDraw["status"]): Promise<LuckyDrawDraw>;

  // Story templates + generations
  listStoryTemplates(): Promise<StoryTemplate[]>;
  getStoryTemplate(templateId: string): Promise<StoryTemplate | null>;
  putStoryTemplate(template: StoryTemplate): Promise<void>;
  recordStoryGeneration(gen: StoryGeneration): Promise<void>;

  // Dashboard user ↔ role/sponsor mapping
  getDashboardUser(userId: string): Promise<DashboardUser | null>;
  putDashboardUser(user: DashboardUser): Promise<void>;
  listDashboardUsers(): Promise<DashboardUser[]>;

  // Abuse protection
  hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}
