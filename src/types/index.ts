/**
 * Domain types for BUB Reward Machine V1.
 * All timestamps are ISO-8601 UTC strings (e.g. 2026-10-15T04:30:00.000Z).
 */

export type ISODate = string;

export const SOURCE_TYPES = ["HOARDING", "NEWSPAPER", "NOTICE", "SOCIAL", "OTHER"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface Campaign {
  campaign_id: string;
  name: string;
  organizer: string;
  starts_on: string; // YYYY-MM-DD (event local date)
  ends_on: string;
  venue: string;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface Source {
  source_id: string; // e.g. H001
  type: SourceType;
  name: string;
  location: string;
  active: boolean;
  /** Counters, maintained atomically. "scans" = QR visits, never claimed as physical reach. */
  scans: number;
  sessions: number;
  plays: number;
  leads: number; // WhatsApp-verified participants
  rewards: number; // rewards claimed
  created_at: ISODate;
  updated_at: ISODate;
  /** true = DEMO record (ids start with demo_), never production data. */
  is_demo?: boolean;
}

/** One recorded QR/source visit (a scan that opened the site) — never an estimate of reach. */
export interface SourceVisit {
  visit_id: string;
  source_id: string;
  source_type: SourceType;
  location: string;
  session_id: string;
  new_session: boolean;
  created_at: ISODate; // visit timestamp (UTC)
  is_demo?: boolean;
}

export interface Sponsor {
  sponsor_id: string;
  name: string;
  logo_url: string | null;
  instagram_url: string | null;
  is_title_sponsor: boolean;
  active: boolean;
  is_demo?: boolean;
  created_at: ISODate;
  updated_at: ISODate;
}

export const REWARD_TYPES = ["VOUCHER", "FREE_PRODUCT", "OFFER", "ENTRY_ONLY"] as const;
export type RewardType = (typeof REWARD_TYPES)[number];

export interface Reward {
  reward_id: string;
  sponsor_id: string;
  name: string;
  description: string;
  type: RewardType;
  /** null = unlimited (only sensible for fallback rewards). */
  total_limit: number | null;
  /** null = no daily cap. */
  daily_limit: number | null;
  /** Units not yet held or claimed. null when unlimited. */
  remaining_inventory: number | null;
  claimed_count: number;
  redeemed_count: number;
  active: boolean;
  /** Window during which this reward can be WON. */
  valid_from: ISODate | null;
  valid_until: ISODate | null;
  /** Window during which the resulting coupon can be REDEEMED (defaults to event dates). */
  redeem_from: ISODate | null;
  redeem_until: ISODate | null;
  /** Fallback rewards are used only when no regular reward is available. */
  fallback: boolean;
  /** Relative selection weight among eligible regular rewards. Never sent to the client. */
  weight: number;
  is_demo?: boolean;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface Session {
  session_id: string;
  source_id: string | null; // null = direct / unknown source
  src_raw: string | null; // raw (sanitised) ?src value when it did not match an active source
  play_id: string | null;
  participant_id: string | null;
  verified_phone: string | null;
  pending_name: string | null;
  pending_phone: string | null;
  game_started_at: ISODate | null;
  created_at: ISODate;
  updated_at: ISODate;
  /** true = DEMO record (ids start with demo_), never production data. */
  is_demo?: boolean;
}

export type PlayStatus = "HELD" | "CLAIMED" | "EXPIRED" | "NO_REWARD";

export interface Play {
  play_id: string;
  session_id: string;
  source_id: string | null;
  box_index: number;
  reward_id: string | null;
  sponsor_id: string | null;
  coupon_code: string | null;
  status: PlayStatus;
  day_key: string; // YYYY-MM-DD in event timezone, used for daily limits
  hold_expires_at: ISODate | null;
  participant_id: string | null;
  created_at: ISODate;
  updated_at: ISODate;
  /** true = DEMO record (ids start with demo_), never production data. */
  is_demo?: boolean;
}

export interface Participant {
  participant_id: string;
  name: string;
  phone: string; // E.164 normalised, e.g. +919876543210
  source_id: string | null;
  session_id: string;
  whatsapp_verified: boolean;
  verified_at: ISODate | null;
  play_id: string | null;
  reward_id: string | null;
  coupon_code: string | null;
  followed_bub_confirmed: boolean;
  followed_organizer_confirmed: boolean;
  followed_sponsor_confirmed: boolean;
  lucky_draw_eligible: boolean;
  lucky_draw_entry_id: string | null;
  entered_at: ISODate | null;
  created_at: ISODate;
  updated_at: ISODate;
  /** true = DEMO record (ids start with demo_), never production data. */
  is_demo?: boolean;
}

export const COUPON_STATUSES = ["ISSUED", "CLAIMED", "REDEEMED", "EXPIRED", "CANCELLED"] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

export interface Coupon {
  coupon_id: string;
  coupon_code: string; // BUB-XXXXXX
  participant_id: string | null; // null while ISSUED (held, not yet claimed)
  play_id: string;
  sponsor_id: string;
  reward_id: string;
  status: CouponStatus;
  issued_at: ISODate;
  claimed_at: ISODate | null;
  redeemed_at: ISODate | null;
  redeemed_by: string | null;
  valid_from: ISODate | null;
  valid_until: ISODate | null;
  created_at: ISODate;
  updated_at: ISODate;
  /** true = DEMO record (ids start with demo_), never production data. */
  is_demo?: boolean;
}

export interface LuckyDrawEntry {
  entry_id: string; // BUB-LD-482917
  participant_id: string;
  source_id: string | null;
  entered_at: ISODate;
  created_at: ISODate;
  /** true = DEMO record (ids start with demo_), never production data. */
  is_demo?: boolean;
}

export type DrawStatus = "SELECTED" | "WINNER" | "REDRAWN";

export interface LuckyDrawDraw {
  draw_id: string;
  entry_id: string;
  participant_id: string;
  prize: string;
  status: DrawStatus;
  redraw_reason: string | null;
  selected_by: string;
  selected_at: ISODate;
  created_at: ISODate;
  updated_at: ISODate;
}

export const VIBES = ["SHOPPER", "EXPLORER", "DEAL_HUNTER", "EXPERIENCE_SEEKER"] as const;
export type Vibe = (typeof VIBES)[number];

export const STORY_FIELDS = ["vibe", "event_name", "dates", "venue", "reward", "sponsor_logo", "hashtag", "branding"] as const;
export type StoryField = (typeof STORY_FIELDS)[number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StoryTemplate {
  template_id: string;
  name: string;
  vibe: Vibe;
  active: boolean;
  sort_order: number;
  /** Drawn beneath the photo (full 1080×1920). Optional. */
  background_asset_url: string | null;
  /** Drawn above the photo, e.g. a PNG with a transparent photo window. Optional. */
  overlay_asset_url: string | null;
  photo_frame: Rect;
  accent_color: string;
  text_color: string;
  supported_fields: StoryField[];
  /** Built-in placeholder design until Media Mileage artwork is uploaded. */
  is_placeholder?: boolean;
  created_at: ISODate;
  updated_at: ISODate;
}

export interface StoryGeneration {
  generation_id: string;
  session_id: string;
  participant_id: string | null;
  template_id: string;
  vibe: Vibe;
  source_id: string | null;
  created_at: ISODate;
  /** true = DEMO record (ids start with demo_), never production data. */
  is_demo?: boolean;
}

export type Role = "ADMIN" | "SPONSOR";

export interface DashboardUser {
  user_id: string; // Cognito sub (or mock id)
  email: string;
  role: Role;
  sponsor_id: string | null;
  created_at: ISODate;
  updated_at: ISODate;
  /** true = DEMO record (ids start with demo_), never production data. */
  is_demo?: boolean;
}

export interface CampaignStats {
  qr_scans: number;
  unique_sessions: number;
  games_started: number;
  game_plays: number;
  verified_participants: number;
  rewards_won: number;
  coupons_issued: number;
  coupons_redeemed: number;
  lucky_draw_entries: number;
  stories_generated: number;
}

export type StatKey = keyof CampaignStats;
export type SourceCounter = "scans" | "sessions" | "plays" | "leads" | "rewards";
