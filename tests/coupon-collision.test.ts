import { afterEach, describe, expect, it, vi } from "vitest";

// Force the first generated coupon code of the second play to collide with an existing one.
const queue: string[] = [];
vi.mock("@/lib/ids", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/ids")>();
  return { ...orig, newCouponCode: vi.fn(() => queue.shift() ?? orig.newCouponCode()) };
});

import { requireSession } from "@/lib/tracking/sessions";
import { playRewardMachine } from "@/lib/rewards/engine";
import { newCouponCode } from "@/lib/ids";
import { setClock } from "@/lib/time";
import { makeCtx, newSession, onlyRewards, freezeClock, DURING_EVENT, SEED_REWARD_IDS } from "./helpers";

describe("6b. coupon code collision retry", () => {
  afterEach(() => setClock(null));

  it("retries with a fresh code when the generated code already exists", async () => {
    freezeClock(DURING_EVENT);
    const { ctx, repo } = await makeCtx();
    await onlyRewards(repo, [SEED_REWARD_IDS.OFFER]);
    await playRewardMachine(ctx, await requireSession(ctx, await newSession(ctx)), 0);
    const taken = [...repo.coupons.keys()][0];
    const inventoryBefore = (await repo.getReward(SEED_REWARD_IDS.OFFER))!.remaining_inventory!;

    queue.push(taken); // next code collides
    const callsBefore = vi.mocked(newCouponCode).mock.calls.length;
    const p = await playRewardMachine(ctx, await requireSession(ctx, await newSession(ctx)), 0);

    expect(p.outcome).toBe("REWARD");
    expect(vi.mocked(newCouponCode).mock.calls.length - callsBefore).toBe(2);
    expect(repo.coupons.size).toBe(2);
    expect(new Set(repo.coupons.keys()).size).toBe(2);
    // Exactly one unit consumed despite the retry.
    expect((await repo.getReward(SEED_REWARD_IDS.OFFER))!.remaining_inventory).toBe(inventoryBefore - 1);
  });
});
