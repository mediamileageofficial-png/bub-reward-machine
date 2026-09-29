import { getServerConfig } from "@/config/server";
import { DynamoRepository } from "@/lib/aws/dynamo-repository";
import { MemoryRepository } from "./memory";
import type { Repository } from "./repository";
import { seedBaseline } from "./baseline";
import { seedDemo } from "./demo";

/**
 * Returns the process-wide repository. In mock mode this is an in-memory store seeded with the
 * production baseline (story templates) plus the DEMO dataset (SEED_DEMO_DATA, default on in mock mode)
 * (kept on globalThis so it survives Next.js dev hot reloads). Data resets on restart.
 */
const g = globalThis as unknown as { __bubRepo?: Promise<Repository> };

export function getRepository(): Promise<Repository> {
  if (!g.__bubRepo) {
    const cfg = getServerConfig();
    g.__bubRepo = (async () => {
      if (cfg.awsMockMode) {
        const repo = new MemoryRepository();
        await seedBaseline(repo);
        if (cfg.seedDemoData) await seedDemo(repo);
        return repo;
      }
      return new DynamoRepository({
        tableName: cfg.aws.tableName,
        region: cfg.aws.region,
        campaignId: cfg.campaignId,
        endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
      });
    })();
  }
  return g.__bubRepo;
}

/** Test hook. */
export function setRepository(repo: Repository | null) {
  g.__bubRepo = repo ? Promise.resolve(repo) : undefined;
}
