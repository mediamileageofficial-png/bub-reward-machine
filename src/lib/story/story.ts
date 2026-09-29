import type { AppContext } from "@/lib/context";
import { badRequest, notFound } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { VIBES, type Session, type StoryTemplate, type Vibe } from "@/types";

/**
 * Story generation is rendered ON THE DEVICE (canvas, 1080×1920). The selfie/photo never leaves
 * the phone in V1, so nothing personal is stored. The server only serves template configuration
 * and counts generations for the "Stories generated" metric.
 */

export type PublicStoryTemplate = Omit<StoryTemplate, "created_at" | "updated_at" | "is_placeholder">;

export function toPublicTemplate(t: StoryTemplate): PublicStoryTemplate {
  const { created_at: _c, updated_at: _u, is_placeholder: _s, ...rest } = t;
  return rest;
}

export async function listActiveTemplates(ctx: AppContext): Promise<PublicStoryTemplate[]> {
  const all = await ctx.repo.listStoryTemplates();
  return all.filter((t) => t.active).map(toPublicTemplate);
}

export async function recordStoryGeneration(ctx: AppContext, session: Session, input: { template_id: unknown; vibe: unknown }) {
  if (typeof input.template_id !== "string") throw badRequest("INVALID_TEMPLATE", "Choose a template.");
  if (typeof input.vibe !== "string" || !VIBES.includes(input.vibe as Vibe)) throw badRequest("INVALID_VIBE", "Choose your BUB vibe.");
  const tpl = await ctx.repo.getStoryTemplate(input.template_id);
  if (!tpl || !tpl.active) throw notFound("TEMPLATE_NOT_FOUND", "Template not available.");
  const id = newId("sty");
  await ctx.repo.recordStoryGeneration({
    generation_id: id,
    session_id: session.session_id,
    participant_id: session.participant_id,
    template_id: tpl.template_id,
    vibe: input.vibe as Vibe,
    source_id: session.source_id,
    created_at: nowIso(),
  });
  await ctx.repo.incrementStat("stories_generated");
  return { generation_id: id };
}
