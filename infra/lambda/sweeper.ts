import { getContext } from "@/lib/context";
import { sweepExpiredHolds } from "@/lib/rewards/engine";
import { logger } from "@/lib/logger";

/** Scheduled (EventBridge, every 5 min): returns expired, unclaimed reward holds to inventory. */
export async function handler() {
  const ctx = await getContext();
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const n = await sweepExpiredHolds(ctx, 100);
    total += n;
    if (n < 100) break;
  }
  logger.info("sweeper.done", { released: total });
  return { released: total };
}
