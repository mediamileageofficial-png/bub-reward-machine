import { z } from "zod";
import type { AppContext } from "@/lib/context";
import { ConditionFailedError, badRequest, conflict, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { maskPhone, normalizePhone } from "@/lib/phone";
import { nowIso } from "@/lib/time";
import { effectiveCouponStatus } from "@/lib/coupons/coupons";
import { drawablePool } from "@/lib/lucky-draw/lucky-draw";
import { REWARD_TYPES, SOURCE_TYPES, STORY_FIELDS, VIBES, type Reward, type Source, type Sponsor, type StoryTemplate } from "@/types";

// ---------------- validation ----------------

const isoOrNull = z.union([z.iso.datetime({ offset: true }), z.null()]).optional();
const urlOrNull = z
  .union([z.url().max(2000), z.string().regex(/^\/[\w\-./]+$/).max(300), z.string().regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).max(2_800_000), z.null(), z.literal("")])
  .optional()
  .transform((v) => (v === "" ? null : v));

export const sourceCreateSchema = z.object({
  source_id: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{1,24}$/, "Use letters, numbers, - or _ (max 24)"),
  type: z.enum(SOURCE_TYPES),
  name: z.string().trim().min(1).max(80),
  location: z.string().trim().max(120).default(""),
  active: z.boolean().default(true),
});
export const sourceUpdateSchema = sourceCreateSchema.omit({ source_id: true }).partial();

export const sponsorCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  logo_url: urlOrNull,
  instagram_url: z.union([z.url().max(300), z.null(), z.literal("")]).optional().transform((v) => (v === "" ? null : v)),
  is_title_sponsor: z.boolean().default(false),
  active: z.boolean().default(true),
});
export const sponsorUpdateSchema = sponsorCreateSchema.partial();

const rewardBase = z.object({
  sponsor_id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).default(""),
  type: z.enum(REWARD_TYPES),
  total_limit: z.union([z.number().int().min(0).max(1_000_000), z.null()]),
  daily_limit: z.union([z.number().int().min(1).max(1_000_000), z.null()]).default(null),
  active: z.boolean().default(true),
  valid_from: isoOrNull,
  valid_until: isoOrNull,
  redeem_from: isoOrNull,
  redeem_until: isoOrNull,
  fallback: z.boolean().default(false),
  weight: z.number().min(0).max(1000).default(1),
});
export const rewardCreateSchema = rewardBase.refine((r) => r.total_limit !== null || r.fallback, {
  message: "Only fallback rewards can have unlimited quantity",
  path: ["total_limit"],
});
export const rewardUpdateSchema = rewardBase.partial();

export const templateSchema = z.object({
  template_id: z.string().regex(/^[a-z0-9_-]{3,64}$/).optional(),
  name: z.string().trim().min(1).max(80),
  vibe: z.enum(VIBES),
  active: z.boolean().default(true),
  sort_order: z.number().int().min(0).max(999).default(10),
  background_asset_url: urlOrNull,
  overlay_asset_url: urlOrNull,
  photo_frame: z.object({ x: z.number().int().min(0).max(1080), y: z.number().int().min(0).max(1920), w: z.number().int().min(50).max(1080), h: z.number().int().min(50).max(1920) }),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  text_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  supported_fields: z.array(z.enum(STORY_FIELDS)).max(STORY_FIELDS.length),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    throw badRequest("VALIDATION_ERROR", `${first.path.join(".") || "input"}: ${first.message}`, { issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  return r.data;
}

// ---------------- overview ----------------

export async function adminOverview(ctx: AppContext) {
  const [stats, sources, rewards] = await Promise.all([ctx.repo.getStats(), ctx.repo.listSources(), ctx.repo.listRewards()]);
  return {
    stats,
    sources: sources.map((s) => ({ source_id: s.source_id, type: s.type, name: s.name, active: s.active, scans: s.scans, sessions: s.sessions, plays: s.plays, leads: s.leads, rewards: s.rewards })),
    inventory: rewards.map((r) => ({ reward_id: r.reward_id, name: r.name, total: r.total_limit, remaining: r.remaining_inventory, claimed: r.claimed_count, redeemed: r.redeemed_count, active: r.active, sold_out: r.remaining_inventory === 0 })),
    mock_mode: { aws: ctx.cfg.awsMockMode, whatsapp: ctx.cfg.whatsappMockMode },
  };
}

// ---------------- sources ----------------

export async function listSourcesAdmin(ctx: AppContext) {
  const sources = await ctx.repo.listSources();
  return sources.map((s) => ({ ...s, qr_url: `${ctx.cfg.appBaseUrl}/play?src=${encodeURIComponent(s.source_id)}` }));
}

export async function createSource(ctx: AppContext, body: unknown): Promise<Source> {
  const input = parse(sourceCreateSchema, body);
  const ts = nowIso();
  const source: Source = { ...input, scans: 0, sessions: 0, plays: 0, leads: 0, rewards: 0, created_at: ts, updated_at: ts };
  try {
    await ctx.repo.createSource(source);
  } catch (e) {
    if (e instanceof ConditionFailedError) throw conflict("SOURCE_EXISTS", `Source ${input.source_id} already exists.`);
    throw e;
  }
  return source;
}

export async function updateSource(ctx: AppContext, id: string, body: unknown) {
  const patch = parse(sourceUpdateSchema, body);
  return ctx.repo.updateSource(id.toUpperCase(), patch);
}

// ---------------- sponsors ----------------

export async function createSponsor(ctx: AppContext, body: unknown): Promise<Sponsor> {
  const input = parse(sponsorCreateSchema, body);
  const ts = nowIso();
  const sponsor: Sponsor = { sponsor_id: newId("spn"), name: input.name, logo_url: input.logo_url ?? null, instagram_url: input.instagram_url ?? null, is_title_sponsor: input.is_title_sponsor, active: input.active, created_at: ts, updated_at: ts };
  await ctx.repo.createSponsor(sponsor);
  return sponsor;
}

export async function updateSponsor(ctx: AppContext, id: string, body: unknown) {
  const patch = parse(sponsorUpdateSchema, body);
  if (!(await ctx.repo.getSponsor(id))) throw notFound("SPONSOR_NOT_FOUND", "Sponsor not found");
  return ctx.repo.updateSponsor(id, patch);
}

// ---------------- rewards ----------------

export async function listRewardsAdmin(ctx: AppContext) {
  const [rewards, sponsors] = await Promise.all([ctx.repo.listRewards(), ctx.repo.listSponsors()]);
  const names = new Map(sponsors.map((s) => [s.sponsor_id, s.name]));
  return rewards.map((r) => ({ ...r, sponsor_name: names.get(r.sponsor_id) ?? "—", held: r.total_limit === null || r.remaining_inventory === null ? 0 : r.total_limit - r.remaining_inventory - r.claimed_count, sold_out: r.remaining_inventory === 0 }));
}

export async function createReward(ctx: AppContext, body: unknown): Promise<Reward> {
  const input = parse(rewardCreateSchema, body);
  if (!(await ctx.repo.getSponsor(input.sponsor_id))) throw badRequest("SPONSOR_NOT_FOUND", "Choose an existing sponsor.");
  const ts = nowIso();
  const reward: Reward = {
    reward_id: newId("rwd"),
    sponsor_id: input.sponsor_id,
    name: input.name,
    description: input.description,
    type: input.type,
    total_limit: input.total_limit,
    daily_limit: input.daily_limit,
    remaining_inventory: input.total_limit,
    claimed_count: 0,
    redeemed_count: 0,
    active: input.active,
    valid_from: input.valid_from ?? null,
    valid_until: input.valid_until ?? null,
    redeem_from: input.redeem_from ?? null,
    redeem_until: input.redeem_until ?? null,
    fallback: input.fallback,
    weight: input.weight,
    created_at: ts,
    updated_at: ts,
  };
  await ctx.repo.createReward(reward);
  return reward;
}

/** Edits a reward. Changing total_limit adjusts remaining inventory atomically by the same delta. */
export async function updateReward(ctx: AppContext, id: string, body: unknown) {
  const input = parse(rewardUpdateSchema, body);
  const current = await ctx.repo.getReward(id);
  if (!current) throw notFound("REWARD_NOT_FOUND", "Reward not found");
  const { total_limit, ...patch } = input;
  let delta = 0;
  if (total_limit !== undefined && total_limit !== current.total_limit) {
    if (total_limit === null || current.total_limit === null) throw badRequest("LIMIT_MODE_CHANGE", "Switching between limited and unlimited isn't supported; create a new reward instead.");
    delta = total_limit - current.total_limit;
  }
  if (patch.sponsor_id && !(await ctx.repo.getSponsor(patch.sponsor_id))) throw badRequest("SPONSOR_NOT_FOUND", "Choose an existing sponsor.");
  try {
    return await ctx.repo.updateReward(id, patch, delta);
  } catch (e) {
    if (e instanceof ConditionFailedError) throw conflict("INVENTORY_BELOW_ZERO", "Quantity can't go below what's already been won or held.");
    throw e;
  }
}

// ---------------- coupons ----------------

export async function searchCoupons(ctx: AppContext, q: URLSearchParams) {
  const [coupons, sponsors, rewards] = await Promise.all([ctx.repo.listCoupons(), ctx.repo.listSponsors(), ctx.repo.listRewards()]);
  const sponsorName = new Map(sponsors.map((s) => [s.sponsor_id, s.name]));
  const rewardName = new Map(rewards.map((r) => [r.reward_id, r.name]));
  const code = (q.get("code") ?? "").trim().toUpperCase();
  const sponsorId = q.get("sponsor_id") ?? "";
  const status = q.get("status") ?? "";
  const participantQ = (q.get("participant") ?? "").trim().toLowerCase();
  const participantPhone = participantQ ? normalizePhone(participantQ) : null;

  const out = [];
  for (const c of coupons) {
    if (c.status === "ISSUED" || c.status === "CANCELLED") {
      if (status !== c.status) continue; // internal hold states are hidden unless explicitly filtered
    }
    const eff = effectiveCouponStatus(c);
    if (code && !c.coupon_code.includes(code)) continue;
    if (sponsorId && c.sponsor_id !== sponsorId) continue;
    if (status && eff !== status) continue;
    const p = c.participant_id ? await ctx.repo.getParticipant(c.participant_id) : null;
    if (participantQ) {
      const match = p && (p.name.toLowerCase().includes(participantQ) || (participantPhone && p.phone === participantPhone) || p.phone.endsWith(participantQ.replace(/\D/g, "") || "__"));
      if (!match) continue;
    }
    out.push({
      coupon_id: c.coupon_id,
      coupon_code: c.coupon_code,
      status: eff,
      sponsor_name: sponsorName.get(c.sponsor_id) ?? "—",
      reward_name: rewardName.get(c.reward_id) ?? "—",
      participant_name: p?.name ?? null,
      participant_phone: p ? maskPhone(p.phone) : null,
      issued_at: c.issued_at,
      claimed_at: c.claimed_at,
      redeemed_at: c.redeemed_at,
      valid_until: c.valid_until,
    });
    if (out.length >= 500) break;
  }
  return out;
}

// ---------------- participants ----------------

export async function searchParticipants(ctx: AppContext, q: URLSearchParams) {
  const [participants, rewards] = await Promise.all([ctx.repo.listParticipants(), ctx.repo.listRewards()]);
  const rewardName = new Map(rewards.map((r) => [r.reward_id, r.name]));
  const name = (q.get("name") ?? "").trim().toLowerCase();
  const phoneQ = (q.get("whatsapp") ?? "").trim();
  const phoneNorm = phoneQ ? normalizePhone(phoneQ) : null;
  const phoneDigits = phoneQ.replace(/\D/g, "");
  const source = (q.get("source") ?? "").trim().toUpperCase();
  const rewardId = q.get("reward_id") ?? "";
  const from = q.get("from") ?? "";
  const to = q.get("to") ?? "";

  return participants
    .filter((p) => !name || p.name.toLowerCase().includes(name))
    .filter((p) => !phoneQ || p.phone === phoneNorm || (phoneDigits.length >= 4 && p.phone.endsWith(phoneDigits)))
    .filter((p) => !source || (source === "DIRECT" ? !p.source_id : p.source_id === source))
    .filter((p) => !rewardId || p.reward_id === rewardId)
    .filter((p) => !from || p.created_at >= from)
    .filter((p) => !to || p.created_at <= to)
    .slice(0, 500)
    .map((p) => ({
      participant_id: p.participant_id,
      name: p.name,
      whatsapp: maskPhone(p.phone), // masked: the full number is not needed to browse
      source_id: p.source_id ?? "DIRECT",
      reward: p.reward_id ? rewardName.get(p.reward_id) ?? "—" : null,
      coupon_code: p.coupon_code,
      lucky_draw_entry_id: p.lucky_draw_entry_id,
      created_at: p.created_at,
    }));
}

// ---------------- lucky draw ----------------

export async function luckyDrawAdmin(ctx: AppContext) {
  const [entries, draws, pool] = await Promise.all([ctx.repo.listLuckyDrawEntries(), ctx.repo.listDraws(), drawablePool(ctx)]);
  const rows = [];
  for (const e of entries.slice(-500).reverse()) {
    const p = await ctx.repo.getParticipant(e.participant_id);
    rows.push({ entry_id: e.entry_id, name: p?.name ?? "—", whatsapp: p ? maskPhone(p.phone) : "—", source_id: e.source_id ?? "DIRECT", entered_at: e.entered_at });
  }
  const drawRows = [];
  for (const d of draws) {
    const p = await ctx.repo.getParticipant(d.participant_id);
    // Full number shown only for selected winners so the team can contact them.
    drawRows.push({ ...d, name: p?.name ?? "—", whatsapp: p && d.status !== "REDRAWN" ? p.phone : p ? maskPhone(p.phone) : "—" });
  }
  return { total_entries: entries.length, eligible_remaining: pool.length, entries: rows, draws: drawRows.reverse() };
}

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  // Spreadsheet formula-injection guard (plain E.164 numbers can't execute, so they pass through).
  if (/^[=+\-@\t\r]/.test(s) && !/^\+\d{6,15}$/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV for the draw ceremony / winner contact. Admin-only; contains full numbers — handle accordingly. */
export async function luckyDrawCsv(ctx: AppContext): Promise<string> {
  const entries = await ctx.repo.listLuckyDrawEntries();
  const lines = [["entry_id", "name", "whatsapp", "source_id", "entered_at_utc"].join(",")];
  for (const e of entries) {
    const p = await ctx.repo.getParticipant(e.participant_id);
    lines.push([e.entry_id, p?.name, p?.phone, e.source_id ?? "DIRECT", e.entered_at].map(csvCell).join(","));
  }
  return lines.join("\n") + "\n";
}

// ---------------- story templates ----------------

export async function upsertTemplate(ctx: AppContext, body: unknown, id?: string): Promise<StoryTemplate> {
  const input = parse(templateSchema, body);
  const templateId = id ?? input.template_id ?? newId("tpl").toLowerCase();
  const existing = await ctx.repo.getStoryTemplate(templateId);
  if (id && !existing) throw notFound("TEMPLATE_NOT_FOUND", "Template not found");
  const ts = nowIso();
  const t: StoryTemplate = {
    template_id: templateId,
    name: input.name,
    vibe: input.vibe,
    active: input.active,
    sort_order: input.sort_order,
    background_asset_url: input.background_asset_url ?? null,
    overlay_asset_url: input.overlay_asset_url ?? null,
    photo_frame: input.photo_frame,
    accent_color: input.accent_color,
    text_color: input.text_color,
    supported_fields: input.supported_fields,
    is_placeholder: existing?.is_placeholder && !input.background_asset_url && !input.overlay_asset_url ? true : undefined,
    created_at: existing?.created_at ?? ts,
    updated_at: ts,
  };
  await ctx.repo.putStoryTemplate(t);
  return t;
}
