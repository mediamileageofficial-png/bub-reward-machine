/**
 * Creates a dashboard login in Cognito and the matching server-side role mapping.
 *
 * Admin:
 *   npm run create:user -- --email ops@aurix.example --role ADMIN
 * Sponsor (sponsor_id from /admin → Sponsors):
 *   npm run create:user -- --email team@sponsor.example --role SPONSOR --sponsor spn_abc123
 *
 * Env: COGNITO_USER_POOL_ID, DYNAMODB_TABLE_NAME, BUB_AWS_REGION.
 * Cognito emails the user a temporary password; they set their own on first sign-in.
 */
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoRepository } from "../src/lib/aws/dynamo-repository";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email");
  const role = arg("role");
  const sponsorId = arg("sponsor") ?? null;
  const poolId = process.env.COGNITO_USER_POOL_ID;
  const table = process.env.DYNAMODB_TABLE_NAME;
  const region = process.env.BUB_AWS_REGION ?? process.env.AWS_REGION ?? "ap-south-1";
  if (!email || (role !== "ADMIN" && role !== "SPONSOR")) throw new Error("Usage: --email <email> --role ADMIN|SPONSOR [--sponsor <sponsor_id>]");
  if (role === "SPONSOR" && !sponsorId) throw new Error("--sponsor is required for SPONSOR users");
  if (!poolId || !table) throw new Error("Set COGNITO_USER_POOL_ID and DYNAMODB_TABLE_NAME");

  const repo = new DynamoRepository({ tableName: table, region, campaignId: process.env.CAMPAIGN_ID ?? "bub-expo-2026" });
  if (sponsorId && !(await repo.getSponsor(sponsorId))) throw new Error(`Sponsor ${sponsorId} not found — create it in /admin first`);

  const cognito = new CognitoIdentityProviderClient({ region });
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: email,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
          ...(sponsorId ? [{ Name: "custom:sponsor_id", Value: sponsorId }] : []),
        ],
        DesiredDeliveryMediums: ["EMAIL"],
      }),
    );
  } catch (e) {
    if (!(e instanceof UsernameExistsException)) throw e;
    console.log("User already exists in Cognito — updating group and mapping.");
  }
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: poolId, Username: email, GroupName: role }));
  const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: email }));
  const sub = user.UserAttributes?.find((a) => a.Name === "sub")?.Value;
  if (!sub) throw new Error("Could not read the user's sub");

  const ts = new Date().toISOString();
  await repo.putDashboardUser({ user_id: sub, email, role, sponsor_id: role === "SPONSOR" ? sponsorId : null, created_at: ts, updated_at: ts });
  console.log(`✓ ${role} ${email} (sub ${sub})${sponsorId ? ` → sponsor ${sponsorId}` : ""}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
