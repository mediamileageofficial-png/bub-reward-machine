import { getServerConfig } from "@/config/server";
import { createContext, type AppContext } from "@/lib/context";
import { MemoryRepository } from "@/lib/db/memory";
import { seedFixtures, SEED_REWARD_IDS } from "./fixtures";
import { touchSession, requireSession } from "@/lib/tracking/sessions";
import { registerParticipant, sendOtp, verifyOtp } from "@/lib/participants";
import { MockWhatsAppProvider } from "@/lib/whatsapp/providers";
import { setClock } from "@/lib/time";
import type { Reward } from "@/types";

export const DURING_EVENT = new Date("2026-10-15T06:00:00.000Z"); // 11:30 IST, day 1
export const BEFORE_EVENT = new Date("2026-10-01T06:00:00.000Z");

export function freezeClock(d: Date) {
  let t = d.getTime();
  setClock(() => new Date(t));
  return { advanceMinutes: (m: number) => (t += m * 60_000), set: (nd: Date) => (t = nd.getTime()) };
}

export async function makeCtx(): Promise<{ ctx: AppContext; repo: MemoryRepository; outbox: MockWhatsAppProvider }> {
  const repo = new MemoryRepository();
  const cfg = getServerConfig();
  await seedFixtures(repo, { eventStartDate: cfg.eventStartDate, eventEndDate: cfg.eventEndDate, now: "2026-09-01T00:00:00.000Z", includeUsers: true });
  const outbox = new MockWhatsAppProvider();
  const ctx = createContext(repo, { ...cfg, otp: { ...cfg.otp, resendSeconds: 0, maxSendsPerHour: 1000 } }, outbox);
  return { ctx, repo, outbox };
}

let phoneCounter = 0;
/** Unique valid Indian mobile numbers for tests. */
export function nextPhone(): string {
  phoneCounter++;
  return `98${String(40000000 + phoneCounter).padStart(8, "0")}`;
}

export async function newSession(ctx: AppContext, src?: string) {
  const state = await touchSession(ctx, { src: src ?? null, event: src ? "visit" : undefined });
  return state.session_id;
}

export async function verifySession(ctx: AppContext, sessionId: string, phone = nextPhone(), name = "Test Person") {
  await registerParticipant(ctx, await requireSession(ctx, sessionId), { name, phone });
  await sendOtp(ctx, await requireSession(ctx, sessionId));
  return verifyOtp(ctx, await requireSession(ctx, sessionId), "123456");
}

/** Leave only the given rewards active (others paused). */
export async function onlyRewards(repo: MemoryRepository, ids: string[]) {
  for (const r of await repo.listRewards()) await repo.updateReward(r.reward_id, { active: ids.includes(r.reward_id) });
}

export async function setReward(repo: MemoryRepository, id: string, patch: Partial<Reward>) {
  const r = repo.rewards.get(id)!;
  Object.assign(r, patch);
}

export { SEED_REWARD_IDS };
