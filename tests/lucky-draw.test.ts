import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireSession } from "@/lib/tracking/sessions";
import { playRewardMachine, claimReward } from "@/lib/rewards/engine";
import { enterLuckyDraw, selectWinner, markWinner, redraw, drawablePool } from "@/lib/lucky-draw/lucky-draw";
import { luckyDrawCsv } from "@/lib/admin/admin";
import { setClock } from "@/lib/time";
import { makeCtx, newSession, verifySession, freezeClock, DURING_EVENT } from "./helpers";
import type { AppContext } from "@/lib/context";
import type { Actor } from "@/lib/auth/actor";

const ALL = { followed_bub: true, followed_organizer: true, followed_sponsor: true };
const ADMIN: Actor = { user_id: "mock-admin", email: "admin@bub.local", role: "ADMIN", sponsor_id: null };

async function completed(ctx: AppContext, name = "Test Person") {
  const sid = await newSession(ctx, "H001");
  await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
  await verifySession(ctx, sid, undefined, name);
  await claimReward(ctx, await requireSession(ctx, sid));
  return sid;
}

describe("8. lucky draw eligibility", () => {
  beforeEach(() => freezeClock(DURING_EVENT));
  afterEach(() => setClock(null));

  it("requires WhatsApp verification", async () => {
    const { ctx } = await makeCtx();
    const sid = await newSession(ctx);
    await playRewardMachine(ctx, await requireSession(ctx, sid), 0);
    await expect(enterLuckyDraw(ctx, await requireSession(ctx, sid), ALL)).rejects.toMatchObject({ code: "VERIFICATION_REQUIRED" });
  });

  it("requires the Reward Machine to be completed", async () => {
    const { ctx } = await makeCtx();
    const sid = await newSession(ctx);
    await verifySession(ctx, sid);
    await expect(enterLuckyDraw(ctx, await requireSession(ctx, sid), ALL)).rejects.toMatchObject({ code: "PLAY_FIRST" });
  });

  it("requires all three follow confirmations", async () => {
    const { ctx } = await makeCtx();
    const sid = await completed(ctx);
    for (const partial of [
      { ...ALL, followed_bub: false },
      { ...ALL, followed_organizer: false },
      { ...ALL, followed_sponsor: false },
    ]) {
      await expect(enterLuckyDraw(ctx, await requireSession(ctx, sid), partial)).rejects.toMatchObject({ code: "FOLLOW_CONFIRMATION_REQUIRED" });
    }
  });

  it("creates a BUB-LD entry and stores the confirmations", async () => {
    const { ctx, repo } = await makeCtx();
    const sid = await completed(ctx);
    const r = await enterLuckyDraw(ctx, await requireSession(ctx, sid), ALL);
    expect(r.entry_id).toMatch(/^BUB-LD-\d{6}$/);
    expect(r.already_entered).toBe(false);
    const p = (await repo.getParticipant((await requireSession(ctx, sid)).participant_id!))!;
    expect(p).toMatchObject({ followed_bub_confirmed: true, followed_organizer_confirmed: true, followed_sponsor_confirmed: true, lucky_draw_eligible: true, lucky_draw_entry_id: r.entry_id });
    expect(p.entered_at).toBe(DURING_EVENT.toISOString());
    expect((await repo.getStats()).lucky_draw_entries).toBe(1);
  });
});

describe("9. duplicate lucky draw prevention", () => {
  beforeEach(() => freezeClock(DURING_EVENT));
  afterEach(() => setClock(null));

  it("returns the same entry on repeat and allows only one entry under concurrency", async () => {
    const { ctx, repo } = await makeCtx();
    const sid = await completed(ctx);
    const results = await Promise.all(Array.from({ length: 10 }, async () => enterLuckyDraw(ctx, await requireSession(ctx, sid), ALL)));
    const ids = new Set(results.map((r) => r.entry_id));
    expect(ids.size).toBe(1);
    expect(repo.entries.size).toBe(1);
    expect(results.filter((r) => !r.already_entered)).toHaveLength(1);
    expect((await repo.getStats()).lucky_draw_entries).toBe(1);
  });

  it("the same number from another session cannot get a second entry", async () => {
    const { ctx, repo } = await makeCtx();
    const phone = "9876500001";
    const s1 = await newSession(ctx);
    await playRewardMachine(ctx, await requireSession(ctx, s1), 0);
    await verifySession(ctx, s1, phone);
    await claimReward(ctx, await requireSession(ctx, s1));
    const first = await enterLuckyDraw(ctx, await requireSession(ctx, s1), ALL);
    const s2 = await newSession(ctx);
    await verifySession(ctx, s2, phone);
    const second = await enterLuckyDraw(ctx, await requireSession(ctx, s2), ALL);
    expect(second.entry_id).toBe(first.entry_id);
    expect(second.already_entered).toBe(true);
    expect(repo.entries.size).toBe(1);
  });
});

describe("lucky draw winner selection (admin)", () => {
  beforeEach(() => freezeClock(DURING_EVENT));
  afterEach(() => setClock(null));

  it("selects from eligible entries, confirms, redraws without repeating a person", async () => {
    const { ctx } = await makeCtx();
    for (let i = 0; i < 3; i++) {
      const sid = await completed(ctx, `Player ${"ABC"[i]}`);
      await enterLuckyDraw(ctx, await requireSession(ctx, sid), ALL);
    }
    const d1 = await selectWinner(ctx, ADMIN, "Grand Prize");
    expect(d1.status).toBe("SELECTED");
    expect((await drawablePool(ctx)).length).toBe(2);
    const d2 = await redraw(ctx, ADMIN, d1.draw_id, "Unreachable");
    expect(d2.entry_id).not.toBe(d1.entry_id);
    const confirmed = await markWinner(ctx, d2.draw_id);
    expect(confirmed.status).toBe("WINNER");
    await expect(markWinner(ctx, d1.draw_id)).rejects.toMatchObject({ code: "DRAW_NOT_SELECTED" });
    await selectWinner(ctx, ADMIN, "Second Prize");
    await expect(selectWinner(ctx, ADMIN, "Third Prize")).rejects.toMatchObject({ code: "NO_ELIGIBLE_ENTRIES" });
  });

  it("exports entries as CSV with a formula-injection guard", async () => {
    const { ctx } = await makeCtx();
    const sid = await completed(ctx, "Asha Kumar");
    await enterLuckyDraw(ctx, await requireSession(ctx, sid), ALL);
    const pid = (await requireSession(ctx, sid)).participant_id!;
    await ctx.repo.updateParticipant(pid, { name: '=HYPERLINK("x")' });
    const csv = await luckyDrawCsv(ctx);
    const [header, row] = csv.trim().split("\n");
    expect(header).toBe("entry_id,name,whatsapp,source_id,entered_at_utc");
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain("+91");
    expect(row).toContain("H001");
  });
});
