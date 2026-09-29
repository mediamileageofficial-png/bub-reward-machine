import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/max";

/**
 * Normalises a user-entered WhatsApp number to E.164 (+919876543210).
 * Returns null for anything that is not a valid mobile-capable number.
 */
export function normalizePhone(input: string, defaultCountry: CountryCode = "IN"): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.trim().replace(/[\s\-().]/g, "");
  if (!/^\+?\d{6,16}$/.test(cleaned) && !/^00\d{6,16}$/.test(cleaned)) return null;
  const candidate = cleaned.startsWith("00") ? `+${cleaned.slice(2)}` : cleaned;
  const parsed = parsePhoneNumberFromString(candidate, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  const type = parsed.getType();
  if (type && !["MOBILE", "FIXED_LINE_OR_MOBILE"].includes(type)) return null;
  return parsed.number; // E.164
}

/** ISO country of an E.164 number (e.g. "IN"), or null. */
export function phoneCountry(e164: string): string | null {
  return parsePhoneNumberFromString(e164)?.country ?? null;
}

/** +91 98•••••210 — for admin lists where the full number is unnecessary. */
export function maskPhone(e164: string): string {
  if (!e164) return "";
  const cc = e164.startsWith("+91") ? "+91 " : e164.slice(0, e164.length - 10) + " ";
  const last10 = e164.slice(-10);
  return `${cc}${last10.slice(0, 2)}${"•".repeat(5)}${last10.slice(-3)}`;
}
