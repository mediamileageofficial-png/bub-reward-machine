import type { DashboardUser, Reward, Source, Sponsor } from "@/types";
import { localDateToUtcIso } from "@/lib/time";
import type { Repository } from "@/lib/db/repository";
import { baselineStoryTemplates } from "@/lib/db/baseline";

/**
 * TEST FIXTURES — used only by the automated tests (independent of the DEMO dataset, so the
 * demo data can change without breaking tests). Not loaded by the application.
 */

export const SEED_SPONSOR_IDS = {
  A: "spn_sample_a",
  B: "spn_sample_b",
  TITLE: "spn_sample_title",
} as const;

export const SEED_REWARD_IDS = {
  VOUCHER: "rwd_sample_voucher500",
  PRODUCT: "rwd_sample_free_product",
  OFFER: "rwd_sample_expo_offer",
  FALLBACK: "rwd_sample_fallback_entry",
} as const;

export const MOCK_USERS: DashboardUser[] = [
  { user_id: "mock-admin", email: "admin@bub.local", role: "ADMIN", sponsor_id: null, created_at: "", updated_at: "" },
  { user_id: "mock-sponsor-a", email: "sponsor-a@bub.local", role: "SPONSOR", sponsor_id: SEED_SPONSOR_IDS.A, created_at: "", updated_at: "" },
  { user_id: "mock-sponsor-b", email: "sponsor-b@bub.local", role: "SPONSOR", sponsor_id: SEED_SPONSOR_IDS.B, created_at: "", updated_at: "" },
  { user_id: "mock-sponsor-title", email: "title-sponsor@bub.local", role: "SPONSOR", sponsor_id: SEED_SPONSOR_IDS.TITLE, created_at: "", updated_at: "" },
];

export async function seedFixtures(repo: Repository, opts: { eventStartDate: string; eventEndDate: string; now?: string; includeUsers?: boolean }) {
  const ts = opts.now ?? new Date().toISOString();
  const eventStart = localDateToUtcIso(opts.eventStartDate, "start", 330);
  const eventEnd = localDateToUtcIso(opts.eventEndDate, "end", 330);

  const sources: Array<Pick<Source, "source_id" | "type" | "name" | "location">> = [
    { source_id: "H001", type: "HOARDING", name: "Salem Junction", location: "Salem Junction" },
    { source_id: "H002", type: "HOARDING", name: "5 Roads", location: "5 Roads, Salem" },
    { source_id: "N001", type: "NEWSPAPER", name: "Newspaper — Edition 1", location: "Print" },
    { source_id: "NT001", type: "NOTICE", name: "Notice — College A", location: "College A (sample)" },
  ];
  for (const s of sources) {
    if (await repo.getSource(s.source_id)) continue;
    await repo.createSource({ ...s, active: true, scans: 0, sessions: 0, plays: 0, leads: 0, rewards: 0, created_at: ts, updated_at: ts });
  }

  const sponsors: Sponsor[] = [
    { sponsor_id: SEED_SPONSOR_IDS.A, name: "BUB Expo Sponsor A (sample)", logo_url: null, instagram_url: null, is_title_sponsor: false, active: true, is_demo: true, created_at: ts, updated_at: ts },
    { sponsor_id: SEED_SPONSOR_IDS.B, name: "BUB Expo Sponsor B (sample)", logo_url: null, instagram_url: null, is_title_sponsor: false, active: true, is_demo: true, created_at: ts, updated_at: ts },
    { sponsor_id: SEED_SPONSOR_IDS.TITLE, name: "Title Sponsor (sample)", logo_url: null, instagram_url: null, is_title_sponsor: true, active: true, is_demo: true, created_at: ts, updated_at: ts },
  ];
  for (const s of sponsors) if (!(await repo.getSponsor(s.sponsor_id))) await repo.createSponsor(s);

  const common = { claimed_count: 0, redeemed_count: 0, active: true, valid_from: null, valid_until: eventEnd, redeem_from: eventStart, redeem_until: eventEnd, is_demo: true, created_at: ts, updated_at: ts };
  const rewards: Reward[] = [
    { ...common, reward_id: SEED_REWARD_IDS.VOUCHER, sponsor_id: SEED_SPONSOR_IDS.A, name: "₹500 Voucher", description: "Sample voucher — redeem at the sponsor stall during BUB Expo.", type: "VOUCHER", total_limit: 100, daily_limit: 20, remaining_inventory: 100, fallback: false, weight: 1 },
    { ...common, reward_id: SEED_REWARD_IDS.PRODUCT, sponsor_id: SEED_SPONSOR_IDS.B, name: "Free Product", description: "Sample free product — collect at the sponsor stall.", type: "FREE_PRODUCT", total_limit: 50, daily_limit: 15, remaining_inventory: 50, fallback: false, weight: 1 },
    { ...common, reward_id: SEED_REWARD_IDS.OFFER, sponsor_id: SEED_SPONSOR_IDS.TITLE, name: "Special Expo Offer", description: "Sample exclusive expo-only offer.", type: "OFFER", total_limit: 300, daily_limit: 100, remaining_inventory: 300, fallback: false, weight: 2 },
    { ...common, reward_id: SEED_REWARD_IDS.FALLBACK, sponsor_id: SEED_SPONSOR_IDS.TITLE, name: "BUB Lucky Draw Entry", description: "Every player gets a shot at the BUB Lucky Draw.", type: "ENTRY_ONLY", total_limit: null, daily_limit: null, remaining_inventory: null, fallback: true, weight: 1, redeem_from: null, redeem_until: null },
  ];
  for (const r of rewards) if (!(await repo.getReward(r.reward_id))) await repo.createReward(r);

  for (const t of baselineStoryTemplates(ts)) if (!(await repo.getStoryTemplate(t.template_id))) await repo.putStoryTemplate(t);

  if (opts.includeUsers) {
    for (const u of MOCK_USERS) if (!(await repo.getDashboardUser(u.user_id))) await repo.putDashboardUser({ ...u, created_at: ts, updated_at: ts });
  }
}
