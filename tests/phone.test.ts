import { describe, expect, it } from "vitest";
import { normalizePhone, maskPhone } from "@/lib/phone";

describe("phone normalisation", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["098765 43210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["0091-98765-43210", "+919876543210"],
  ])("%s → %s", (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(["12345", "abcdefghij", "", "1234567890", "+91 4272 123456"])("rejects %s", (input) => expect(normalizePhone(input)).toBeNull());

  it("masks numbers for admin lists", () => {
    expect(maskPhone("+919876543210")).toBe("+91 98•••••210");
  });
});
