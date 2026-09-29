import { bub } from "@/config/bub";
import type { StoryTemplate } from "@/types";
import type { Repository } from "./repository";

/**
 * PRODUCTION BASELINE — the only records the app seeds outside demo mode:
 * the four built-in BUB story templates (one per vibe). They are flagged `is_placeholder`
 * until Media Mileage artwork is uploaded in Admin → Story Templates.
 * No sponsors, rewards, sources or participants are ever created here.
 */
export function baselineStoryTemplates(ts: string): StoryTemplate[] {
  const base = {
    active: true,
    background_asset_url: null,
    overlay_asset_url: null,
    photo_frame: { x: 90, y: 440, w: 900, h: 930 },
    accent_color: bub.brand.colors.orange,
    text_color: bub.brand.colors.black,
    supported_fields: ["branding", "vibe", "event_name", "dates", "venue", "reward", "sponsor_logo", "hashtag"] as StoryTemplate["supported_fields"],
    is_placeholder: true,
    created_at: ts,
    updated_at: ts,
  };
  return [
    { ...base, template_id: "tpl_bub_shopper", name: "BUB — Shopper", vibe: "SHOPPER", sort_order: 1 },
    { ...base, template_id: "tpl_bub_explorer", name: "BUB — Explorer", vibe: "EXPLORER", sort_order: 2 },
    { ...base, template_id: "tpl_bub_deal_hunter", name: "BUB — Deal Hunter", vibe: "DEAL_HUNTER", sort_order: 3 },
    { ...base, template_id: "tpl_bub_experience", name: "BUB — Experience Seeker", vibe: "EXPERIENCE_SEEKER", sort_order: 4 },
  ];
}

export async function seedBaseline(repo: Repository, ts = new Date().toISOString()) {
  for (const t of baselineStoryTemplates(ts)) if (!(await repo.getStoryTemplate(t.template_id))) await repo.putStoryTemplate(t);
}
