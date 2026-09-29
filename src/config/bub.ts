/**
 * BUB Reward Machine — THE central configuration.
 *
 * Every piece of event information, brand setting, Instagram link, title-sponsor detail,
 * WhatsApp setting and the campaign status lives here. Components import `bub` and never
 * hard-code event facts (a test enforces this: tests/demo-config.test.ts).
 *
 * Values come from environment variables with the defaults below.
 *  - NEXT_PUBLIC_* values are safe for the browser.
 *  - `bub.whatsapp` is read on the SERVER only (its env vars are not NEXT_PUBLIC); it holds
 *    non-secret settings. Credentials never live here — see src/config/server.ts.
 */

const env = (key: string, fallback: string) => {
  const v = process.env[key];
  return v !== undefined && v !== "" ? v : fallback;
};

export type CampaignStatus = "live" | "paused" | "ended";

function toStatus(v: string | undefined): CampaignStatus {
  const s = (v ?? "").toLowerCase();
  return s === "paused" || s === "ended" ? s : "live";
}

/** Next.js only inlines NEXT_PUBLIC_* when referenced literally, so each is spelled out. */
const pub = {
  campaignStatus: process.env.NEXT_PUBLIC_CAMPAIGN_STATUS,
  campaignMessage: process.env.NEXT_PUBLIC_CAMPAIGN_STATUS_MESSAGE,
  eventName: process.env.NEXT_PUBLIC_EVENT_NAME,
  eventShortName: process.env.NEXT_PUBLIC_EVENT_SHORT_NAME,
  eventYear: process.env.NEXT_PUBLIC_EVENT_YEAR,
  datesLabel: process.env.NEXT_PUBLIC_EVENT_DATES_LABEL,
  datesShort: process.env.NEXT_PUBLIC_EVENT_DATES_SHORT,
  startDate: process.env.NEXT_PUBLIC_EVENT_START_DATE,
  endDate: process.env.NEXT_PUBLIC_EVENT_END_DATE,
  timezone: process.env.NEXT_PUBLIC_EVENT_TIMEZONE,
  utcOffset: process.env.NEXT_PUBLIC_EVENT_UTC_OFFSET_MINUTES,
  venue: process.env.NEXT_PUBLIC_EVENT_VENUE,
  venueShort: process.env.NEXT_PUBLIC_EVENT_VENUE_SHORT,
  city: process.env.NEXT_PUBLIC_EVENT_CITY,
  organizer: process.env.NEXT_PUBLIC_ORGANIZER_NAME,
  hashtag: process.env.NEXT_PUBLIC_STORY_HASHTAG,
  termsUrl: process.env.NEXT_PUBLIC_TERMS_URL,
  logoUrl: process.env.NEXT_PUBLIC_BUB_LOGO_URL,
  heroImageUrl: process.env.NEXT_PUBLIC_HERO_IMAGE_URL,
  colorBackground: process.env.NEXT_PUBLIC_BRAND_BACKGROUND,
  colorOrange: process.env.NEXT_PUBLIC_BRAND_ORANGE,
  igBubUrl: process.env.NEXT_PUBLIC_INSTAGRAM_BUB_URL,
  igBubHandle: process.env.NEXT_PUBLIC_INSTAGRAM_BUB_HANDLE,
  igOrgUrl: process.env.NEXT_PUBLIC_INSTAGRAM_ORGANIZER_URL,
  igOrgHandle: process.env.NEXT_PUBLIC_INSTAGRAM_ORGANIZER_HANDLE,
  igTitleUrl: process.env.NEXT_PUBLIC_INSTAGRAM_TITLE_SPONSOR_URL,
  igTitleHandle: process.env.NEXT_PUBLIC_INSTAGRAM_TITLE_SPONSOR_HANDLE,
  titleSponsorName: process.env.NEXT_PUBLIC_TITLE_SPONSOR_NAME,
  titleSponsorLogo: process.env.NEXT_PUBLIC_TITLE_SPONSOR_LOGO_URL,
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
  maxPhotoMb: process.env.NEXT_PUBLIC_STORY_MAX_PHOTO_MB,
};
const or = (v: string | undefined, fallback: string) => (v !== undefined && v !== "" ? v : fallback);

export const bub = {
  campaign: {
    id: env("CAMPAIGN_ID", "bub-expo-2026"),
    /** live = normal; paused = no new plays (existing coupons still work); ended = campaign over. */
    status: toStatus(pub.campaignStatus),
    statusMessage: or(pub.campaignMessage, ""),
  },

  event: {
    name: or(pub.eventName, "BUB Expo 2026"),
    shortName: or(pub.eventShortName, "BUB"),
    year: or(pub.eventYear, "2026"),
    datesLabel: or(pub.datesLabel, "15–17 October 2026"),
    datesShort: or(pub.datesShort, "15–17 OCT"),
    /** Event-local dates (YYYY-MM-DD). Default coupon redemption window. */
    startDate: or(pub.startDate, "2026-10-15"),
    endDate: or(pub.endDate, "2026-10-17"),
    timezone: or(pub.timezone, "Asia/Kolkata"),
    /** Fixed UTC offset of the event timezone (IST = +330). Used for date inputs in the admin. */
    utcOffsetMinutes: Number(or(pub.utcOffset, "330")),
    locale: "en-IN",
    venue: or(pub.venue, "Sree Varalakshmi Mahal, Salem"),
    venueShort: or(pub.venueShort, "Sree Varalakshmi Mahal"),
    city: or(pub.city, "Salem"),
    organizer: or(pub.organizer, "Aurix Events"),
    pillars: ["SHOP", "DISCOVER", "EXPERIENCE", "CONNECT"] as const,
    hashtag: or(pub.hashtag, "#MyBUBStory"),
    /** Organiser's terms page — legal copy is supplied by BUB/Aurix, never invented in code. */
    termsUrl: or(pub.termsUrl, ""),
  },

  brand: {
    /** Empty = placeholder wordmark. Set to the official BUB logo (PNG/SVG URL). */
    logoUrl: or(pub.logoUrl, ""),
    heroImageUrl: or(pub.heroImageUrl, ""),
    /** Official BUB Expo palette. */
    colors: {
      background: or(pub.colorBackground, "#F3EEE4"),
      orange: or(pub.colorOrange, "#F0440F"),
      black: "#111111",
      white: "#FFFFFF",
      muted: "#5A5752",
      border: "#D8D0C4",
      success: "#13843F",
      danger: "#C4240B",
    },
  },

  instagram: {
    bub: { url: or(pub.igBubUrl, "https://www.instagram.com/"), handle: or(pub.igBubHandle, "BUB Expo") },
    organizer: { url: or(pub.igOrgUrl, "https://www.instagram.com/"), handle: or(pub.igOrgHandle, "Aurix Events") },
    titleSponsor: { url: or(pub.igTitleUrl, "https://www.instagram.com/"), handle: or(pub.igTitleHandle, "Title Sponsor") },
  },

  titleSponsor: {
    name: or(pub.titleSponsorName, "Title Sponsor"),
    logoUrl: or(pub.titleSponsorLogo, ""),
  },

  story: {
    width: 1080,
    height: 1920,
    maxPhotoBytes: Number(or(pub.maxPhotoMb, "15")) * 1024 * 1024,
    acceptedPhotoTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const,
  },

  /** SERVER-SIDE settings (not exposed to the browser). No credentials here. */
  whatsapp: {
    mockMode: ["1", "true", "yes", "on"].includes(env("WHATSAPP_MOCK_MODE", "true").toLowerCase()),
    /** meta_cloud | msg91 */
    provider: env("WHATSAPP_PROVIDER", "meta_cloud"),
    templateLanguage: env("WHATSAPP_TEMPLATE_LANGUAGE", "en"),
    templates: {
      otp: env("WHATSAPP_TEMPLATE_OTP", "bub_otp"),
      reward: env("WHATSAPP_TEMPLATE_REWARD", "bub_reward_won"),
      coupon: env("WHATSAPP_TEMPLATE_COUPON", "bub_coupon_code"),
      reminder: env("WHATSAPP_TEMPLATE_REMINDER", "bub_event_reminder"),
    },
    otp: {
      length: 6,
      ttlSeconds: Number(env("OTP_TTL_SECONDS", "600")),
      maxAttempts: Number(env("OTP_MAX_ATTEMPTS", "5")),
      resendSeconds: Number(env("OTP_RESEND_SECONDS", "30")),
      maxSendsPerHour: Number(env("OTP_MAX_SENDS_PER_HOUR", "5")),
      mockCode: "123456",
    },
    /** Only numbers from these countries can receive OTPs (limits cost/abuse). */
    allowedCountries: env("WHATSAPP_ALLOWED_COUNTRIES", "IN").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean),
  },

  api: {
    /** Empty = same origin (recommended). */
    baseUrl: or(pub.apiBaseUrl, "").replace(/\/$/, ""),
  },
} as const;

export type BubConfig = typeof bub;

/** Format an instant in the event's timezone. */
export function formatEventTime(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(bub.event.locale, { ...opts, timeZone: bub.event.timezone });
}
