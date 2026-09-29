import { bub } from "./bub";

/**
 * Server-side configuration: credentials + infrastructure. Never import this from client components.
 * Event facts and non-secret WhatsApp settings come from the central config (src/config/bub.ts).
 * Every external credential comes from the environment; nothing is hard-coded.
 *
 * Note: AWS Amplify Hosting does not allow variables prefixed with "AWS_", so every
 * AWS_* variable below also accepts a BUB_* alias (e.g. BUB_AWS_MOCK_MODE).
 */

function read(name: string, ...aliases: string[]): string | undefined {
  for (const key of [name, ...aliases]) {
    const v = process.env[key];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function int(v: string | undefined, fallback: number): number {
  const n = v === undefined ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function awsCredentials(): { accessKeyId: string; secretAccessKey: string } | undefined {
  const accessKeyId = read("BUB_AWS_ACCESS_KEY_ID");
  const secretAccessKey = read("BUB_AWS_SECRET_ACCESS_KEY");
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined;
}

export function getServerConfig() {
  const awsMock = bool(read("AWS_MOCK_MODE", "BUB_AWS_MOCK_MODE"), process.env.NODE_ENV !== "production");
  const secret = read("SESSION_SECRET");
  // Fail closed: OTP hashes and dashboard tokens depend on this secret.
  if (!awsMock && (!secret || secret.length < 32)) throw new Error("SESSION_SECRET (32+ chars) is required when AWS_MOCK_MODE=false");
  return {
    awsMockMode: awsMock,
    whatsappMockMode: bub.whatsapp.mockMode,
    /** Mock dashboard login is only ever available in mock mode, and never in a production build unless explicitly allowed. */
    allowMockLogin: awsMock && (process.env.NODE_ENV !== "production" || bool(read("ALLOW_MOCK_LOGIN"), false)),
    campaignStatus: bub.campaign.status,
    nodeEnv: process.env.NODE_ENV ?? "development",

    campaignId: bub.campaign.id,
    appBaseUrl: (read("APP_BASE_URL") ?? "http://localhost:3000").replace(/\/$/, ""),
    sessionSecret: secret ?? "local-dev-secret-change-me-only-for-mock-mode",

    aws: {
      region: read("BUB_AWS_REGION", "AWS_REGION") ?? "ap-south-1",
      tableName: read("DYNAMODB_TABLE_NAME") ?? "bub-reward-machine",
      assetsBucket: read("S3_ASSETS_BUCKET") ?? "",
      tempBucket: read("S3_TEMP_BUCKET") ?? "",
      assetsPublicBaseUrl: (read("ASSETS_PUBLIC_BASE_URL") ?? "").replace(/\/$/, ""),
      // Explicit keys for hosts that reserve AWS_* (Vercel, Amplify). Unset = default credential chain.
      credentials: awsCredentials(),
    },

    cognito: {
      userPoolId: read("COGNITO_USER_POOL_ID") ?? "",
      clientId: read("COGNITO_CLIENT_ID") ?? "",
      clientSecret: read("COGNITO_CLIENT_SECRET") ?? "",
      domain: (read("COGNITO_DOMAIN") ?? "").replace(/\/$/, ""),
    },

    whatsapp: {
      provider: bub.whatsapp.provider,
      templateLanguage: bub.whatsapp.templateLanguage,
      templates: { ...bub.whatsapp.templates },
      allowedCountries: [...bub.whatsapp.allowedCountries],
      // Meta WhatsApp Cloud API (or a BSP exposing the same contract)
      apiBaseUrl: (read("WHATSAPP_API_BASE_URL") ?? "https://graph.facebook.com/v21.0").replace(/\/$/, ""),
      accessToken: read("WHATSAPP_ACCESS_TOKEN") ?? "",
      phoneNumberId: read("WHATSAPP_PHONE_NUMBER_ID") ?? "",
      // MSG91 WhatsApp
      msg91AuthKey: read("MSG91_AUTH_KEY") ?? "",
      msg91IntegratedNumber: read("MSG91_INTEGRATED_NUMBER") ?? "",
      msg91Namespace: read("MSG91_TEMPLATE_NAMESPACE") ?? "",
      msg91ApiBaseUrl: (read("MSG91_API_BASE_URL") ?? "https://api.msg91.com").replace(/\/$/, ""),
    },

    otp: { ...bub.whatsapp.otp },

    rewards: {
      holdMinutes: int(read("REWARD_HOLD_MINUTES"), 20),
    },

    eventTimezone: bub.event.timezone,
    eventStartDate: bub.event.startDate,
    eventEndDate: bub.event.endDate,
    eventUtcOffsetMinutes: bub.event.utcOffsetMinutes,
    defaultCountry: (read("DEFAULT_PHONE_COUNTRY") ?? "IN") as "IN",
    seedDemoData: bool(read("SEED_DEMO_DATA"), awsMock),
    sponsorSelfRedemption: bool(read("SPONSOR_SELF_REDEMPTION"), false),
    trustProxyHeaders: bool(read("TRUST_PROXY_HEADERS"), true),
  };
}

export type ServerConfig = ReturnType<typeof getServerConfig>;

export function assertProductionConfig(cfg: ServerConfig = getServerConfig()): string[] {
  const problems: string[] = [];
  if (!cfg.sessionSecret || cfg.sessionSecret.length < 32) problems.push("SESSION_SECRET must be at least 32 characters");
  if (!cfg.awsMockMode) {
    if (!cfg.aws.tableName) problems.push("DYNAMODB_TABLE_NAME is required");
    if (!cfg.cognito.userPoolId || !cfg.cognito.clientId) problems.push("COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID are required");
  }
  if (!cfg.whatsappMockMode) {
    if (cfg.whatsapp.provider === "msg91" && (!cfg.whatsapp.msg91AuthKey || !cfg.whatsapp.msg91IntegratedNumber)) {
      problems.push("MSG91_AUTH_KEY and MSG91_INTEGRATED_NUMBER are required when WHATSAPP_PROVIDER=msg91");
    }
    if (cfg.whatsapp.provider === "meta_cloud" && (!cfg.whatsapp.accessToken || !cfg.whatsapp.phoneNumberId)) {
      problems.push("WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required when WHATSAPP_PROVIDER=meta_cloud");
    }
  }
  return problems;
}
