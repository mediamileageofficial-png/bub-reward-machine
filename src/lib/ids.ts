import { randomBytes, randomInt, randomUUID } from "node:crypto";

/** Unambiguous alphabet: no 0/O, 1/I/L. 30 symbols → 30^6 ≈ 729M codes. */
const COUPON_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export function newSessionId(): string {
  // 128 bits of randomness; acts as the bearer secret for the public flow.
  return randomBytes(16).toString("hex");
}

/** Coupon code like BUB-8F4K2Q. Uniqueness is enforced by a conditional write, with retry on collision. */
export function newCouponCode(prefix = "BUB"): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += COUPON_ALPHABET[randomInt(COUPON_ALPHABET.length)];
  return `${prefix}-${out}`;
}

/** Lucky Draw ID like BUB-LD-482917. Uniqueness is enforced by a conditional write, with retry on collision. */
export function newLuckyDrawId(): string {
  return `BUB-LD-${randomInt(100000, 1000000)}`;
}

export const COUPON_CODE_PATTERN = /^BUB-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
