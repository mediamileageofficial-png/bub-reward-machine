/**
 * Seeds a real DynamoDB table (idempotent).
 *
 *   npm run seed:dynamo                    # PRODUCTION BASELINE only: the 4 BUB story templates
 *   npm run seed:dynamo -- --demo          # baseline + DEMO dataset (staging walkthroughs only)
 *
 * Env: DYNAMODB_TABLE_NAME, BUB_AWS_REGION (optional DYNAMODB_ENDPOINT for DynamoDB Local).
 * DEMO data is refused for tables whose name contains "prod" unless --force is also passed.
 */
import { DynamoRepository } from "../src/lib/aws/dynamo-repository";
import { seedBaseline } from "../src/lib/db/baseline";
import { seedDemo } from "../src/lib/db/demo";

async function main() {
  const tableName = process.env.DYNAMODB_TABLE_NAME;
  if (!tableName) throw new Error("Set DYNAMODB_TABLE_NAME");
  const demo = process.argv.includes("--demo");
  if (demo && /prod/i.test(tableName) && !process.argv.includes("--force")) {
    throw new Error(`Refusing to load DEMO data into "${tableName}". Use a staging table (or add --force if you really mean it).`);
  }
  const repo = new DynamoRepository({
    tableName,
    region: process.env.BUB_AWS_REGION ?? process.env.AWS_REGION ?? "ap-south-1",
    campaignId: process.env.CAMPAIGN_ID ?? "bub-expo-2026",
    endpoint: process.env.DYNAMODB_ENDPOINT,
  });
  await seedBaseline(repo);
  console.log(`✓ baseline story templates → ${tableName}`);
  if (demo) {
    await seedDemo(repo);
    console.log(`✓ DEMO dataset (ids start with demo_) → ${tableName}`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
