import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { MemoryRepository } from "@/lib/db/memory";
import { seedDemo, DEMO_IDS, DEMO_PARTICIPANTS, isDemoId } from "@/lib/db/demo";
import { seedBaseline } from "@/lib/db/baseline";
import { bub } from "@/config/bub";
import { checkPhotoMeta, sniffImageType, validatePhotoFile } from "@/lib/story/photo";
import { buildMsg91Body } from "@/lib/whatsapp/providers";

describe("demo data", () => {
  it("contains exactly the requested demo set, all identifiable, with consistent counters", async () => {
    const repo = new MemoryRepository();
    await seedBaseline(repo);
    await seedDemo(repo, { now: new Date("2026-10-15T08:00:00.000Z") });

    expect(await repo.listSponsors()).toHaveLength(2);
    expect(await repo.listRewards()).toHaveLength(3);
    expect(await repo.listSources()).toHaveLength(3);
    expect(await repo.listParticipants()).toHaveLength(5);
    const coupons = await repo.listCoupons();
    expect(coupons.length).toBe(4);
    expect(await repo.listLuckyDrawEntries()).toHaveLength(3);

    for (const s of await repo.listSponsors()) expect(s.is_demo && isDemoId(s.sponsor_id) && s.name.startsWith("[DEMO]")).toBe(true);
    for (const r of await repo.listRewards()) expect(r.is_demo && isDemoId(r.reward_id) && r.name.startsWith("[DEMO]")).toBe(true);
    for (const s of await repo.listSources()) expect(s.is_demo && s.name.startsWith("[DEMO]")).toBe(true);
    for (const p of await repo.listParticipants()) expect(p.is_demo && isDemoId(p.participant_id) && p.name.startsWith("[DEMO]")).toBe(true);
    for (const c of coupons) expect(c.is_demo && isDemoId(c.coupon_id) && c.coupon_code.startsWith("BUB-DEMX")).toBe(true);
    for (const e of await repo.listLuckyDrawEntries()) expect(e.is_demo && e.entry_id.startsWith("BUB-LD-9990")).toBe(true);
    for (const u of await repo.listDashboardUsers()) expect(u.is_demo && isDemoId(u.user_id)).toBe(true);

    expect(coupons.filter((c) => c.status === "REDEEMED")).toHaveLength(1);
    expect(coupons.filter((c) => c.status === "CLAIMED")).toHaveLength(3);
    const voucher = (await repo.getReward(DEMO_IDS.rewards.voucher))!;
    expect(voucher).toMatchObject({ total_limit: 100, remaining_inventory: 98, claimed_count: 2, redeemed_count: 1 });
    const stats = await repo.getStats();
    expect(stats).toMatchObject({ verified_participants: 5, rewards_won: 5, coupons_issued: 4, coupons_redeemed: 1, lucky_draw_entries: 3, qr_scans: 5 });
    expect((await repo.getSource("H001"))).toMatchObject({ scans: 2, leads: 2, rewards: 2 });
    expect(await repo.listSourceVisits("NT001", 10)).toHaveLength(1);
    expect(DEMO_PARTICIPANTS).toHaveLength(5);
  });

  it("is idempotent and the production baseline contains no sponsors/rewards/participants", async () => {
    const repo = new MemoryRepository();
    await seedBaseline(repo);
    expect(await repo.listSponsors()).toHaveLength(0);
    expect(await repo.listRewards()).toHaveLength(0);
    expect(await repo.listStoryTemplates()).toHaveLength(4);
    await seedDemo(repo);
    await seedDemo(repo);
    expect(await repo.listParticipants()).toHaveLength(5);
  });
});

describe("central config", () => {
  it("exposes the official palette and event facts", () => {
    expect(bub.brand.colors).toMatchObject({ background: "#F3EEE4", orange: "#F0440F", black: "#111111", white: "#FFFFFF", muted: "#5A5752", border: "#D8D0C4" });
    expect(bub.event).toMatchObject({ name: "BUB Expo 2026", venue: "Sree Varalakshmi Mahal, Salem", organizer: "Aurix Events" });
    expect(["live", "paused", "ended"]).toContain(bub.campaign.status);
  });

  it("no component or page hard-codes event information", () => {
    const roots = ["src/app", "src/components", "src/lib"];
    const banned = [/Sree Varalakshmi/, /Aurix Events/, /15–17 Oct/i, /BUB Expo 2026/, /#F0440F/i, /#F3EEE4/i, /Asia\/Kolkata/];
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|css)$/.test(f) && !p.endsWith("globals.css")) {
          const text = readFileSync(p, "utf8");
          for (const re of banned) if (re.test(text)) offenders.push(`${p} ~ ${re}`);
        }
      }
    };
    roots.forEach(walk);
    expect(offenders).toEqual([]);
  });
});

describe("story photo validation", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const webp = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
  const heic = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode("ftypheic")]);

  it("recognises real image signatures", () => {
    expect(sniffImageType(jpeg)).toBe("image/jpeg");
    expect(sniffImageType(png)).toBe("image/png");
    expect(sniffImageType(webp)).toBe("image/webp");
    expect(sniffImageType(heic)).toBe("image/heic");
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns"))).toBeNull();
  });

  it("enforces type and size limits", async () => {
    expect(checkPhotoMeta({ type: "image/jpeg", size: 0 })).toMatchObject({ ok: false, code: "EMPTY" });
    expect(checkPhotoMeta({ type: "image/jpeg", size: bub.story.maxPhotoBytes + 1 })).toMatchObject({ ok: false, code: "TOO_LARGE" });
    expect(checkPhotoMeta({ type: "image/svg+xml", size: 100 })).toMatchObject({ ok: false, code: "UNSUPPORTED_TYPE" });
    expect(checkPhotoMeta({ type: "image/gif", size: 100 })).toMatchObject({ ok: false, code: "UNSUPPORTED_TYPE" });
    expect(await validatePhotoFile(new Blob([jpeg], { type: "image/jpeg" }))).toMatchObject({ ok: true, type: "image/jpeg" });
    // A text file renamed/typed as JPEG is rejected by its signature.
    expect(await validatePhotoFile(new Blob([new TextEncoder().encode("hello world, not an image")], { type: "image/jpeg" }))).toMatchObject({ ok: false, code: "NOT_AN_IMAGE" });
  });
});

describe("WhatsApp provider abstraction", () => {
  it("MSG91 request body maps template params without changing the app flow", () => {
    const body = buildMsg91Body({ to: "+919876543210", template: "bub_otp", language: "en", bodyParams: ["123456"], buttonParam: "123456" }, { integratedNumber: "919000000000", namespace: "" });
    expect(body).toMatchObject({
      integrated_number: "919000000000",
      content_type: "template",
      payload: { type: "template", template: { name: "bub_otp", to_and_components: [{ to: ["919876543210"], components: { body_1: { type: "text", value: "123456" }, button_1: { value: "123456" } } }] } },
    });
  });
});
