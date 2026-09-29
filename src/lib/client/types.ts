/** Shapes returned by the public API (kept in sync with src/lib/tracking + src/lib/rewards). */
export interface PublicReward {
  name: string;
  description: string;
  type: "VOUCHER" | "FREE_PRODUCT" | "OFFER" | "ENTRY_ONLY";
  sponsor_name: string;
  sponsor_logo_url: string | null;
  issues_coupon: boolean;
}

export interface PublicPlay {
  play_id: string;
  box_index: number;
  outcome: "REWARD" | "ENTRY" | "NONE";
  status: "PENDING_VERIFICATION" | "CLAIMED" | "EXPIRED";
  reward: PublicReward | null;
  hold_expires_at: string | null;
}

export interface SessionState {
  session_id: string;
  source: { source_id: string; type: string; name: string } | null;
  play: PublicPlay | null;
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

export interface ClaimResponse {
  play: PublicPlay;
  coupon: { coupon_code: string; status: string; valid_from: string | null; valid_until: string | null } | null;
  reward_changed: boolean;
  whatsapp: { status: "MOCKED" | "ACCEPTED" | "FAILED" | "SKIPPED" };
}

export interface PublicCoupon {
  coupon_code: string;
  status: "CLAIMED" | "REDEEMED" | "EXPIRED";
  reward_name: string;
  reward_description: string;
  sponsor_name: string;
  sponsor_logo_url: string | null;
  valid_from: string | null;
  valid_until: string | null;
  redeemed_at: string | null;
}
