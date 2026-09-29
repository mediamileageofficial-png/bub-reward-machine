import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { touchSession, requireSession, sanitizeSourceId } from "@/lib/tracking/sessions";
import { playRewardMachine } from "@/lib/rewards/engine";
import { makeCtx, verifySession, freezeClock, DURING_EVENT } from "./helpers";
import { setClock } from "@/lib/time";

describe("1. source / QR tracking", () => {
  beforeEach(() => freezeClock(DURING_EVENT));
  afterEach(() => setClock(null));

  it("attributes a new session to a valid ?src and counts a QR scan + unique session", async () => {
    const { ctx, repo } = await makeCtx();
    const s = await touchSession(ctx, { src: "h001", event: "visit" });
    expect(s.source).toMatchObject({ source_id: "H001", type: "HOARDING", name: "Salem Junction" });
    const src = (await repo.getSource("H001"))!;
    expect(src.scans).toBe(1);
    expect(src.sessions).toBe(1);
    const stats = await repo.getStats();
    expect(stats.qr_scans).toBe(1);
    expect(stats.unique_sessions).toBe(1);
  });

  it("re-visiting with the same session counts another QR scan but not another unique session", async () => {
    const { ctx, repo } = await makeCtx();
    const s = await touchSession(ctx, { src: "H002", event: "visit" });
    await touchSession(ctx, { session_id: s.session_id, src: "H002", event: "visit" });
    const stats = await repo.getStats();
    expect(stats.qr_scans).toBe(2);
    expect(stats.unique_sessions).toBe(1);
    expect((await repo.getSource("H002"))!.sessions).toBe(1);
  });

  it("keeps first-touch attribution on the session", async () => {
    const { ctx } = await makeCtx();
    const s = await touchSession(ctx, { src: "N001", event: "visit" });
    const again = await touchSession(ctx, { session_id: s.session_id, src: "H001", event: "visit" });
    expect(again.source?.source_id).toBe("N001");
  });

  it("treats unknown, malformed and inactive sources as direct traffic (no QR scan)", async () => {
    const { ctx, repo } = await makeCtx();
    await repo.updateSource("NT001", { active: false });
    for (const src of ["ZZZ999", "<script>", "NT001"]) {
      const s = await touchSession(ctx, { src, event: "visit" });
      expect(s.source).toBeNull();
    }
    expect((await repo.getStats()).qr_scans).toBe(0);
    const session = await repo.getSession((await touchSession(ctx, { src: "ZZZ999" })).session_id);
    expect(session?.src_raw).toBe("ZZZ999");
    expect(sanitizeSourceId("<script>")).toBeNull();
  });

  it("carries the source through play, participant (lead) and reward counters", async () => {
    const { ctx, repo } = await makeCtx();
    const s = await touchSession(ctx, { src: "H001", event: "visit" });
    await touchSession(ctx, { session_id: s.session_id, event: "game_started" });
    await playRewardMachine(ctx, await requireSession(ctx, s.session_id), 1);
    await verifySession(ctx, s.session_id);
    const { claimReward } = await import("@/lib/rewards/engine");
    await claimReward(ctx, await requireSession(ctx, s.session_id));
    const src = (await repo.getSource("H001"))!;
    expect(src).toMatchObject({ scans: 1, sessions: 1, plays: 1, leads: 1, rewards: 1 });
    const participant = [...repo.participants.values()][0];
    expect(participant.source_id).toBe("H001");
    expect((await repo.getStats()).games_started).toBe(1);
  });
});
