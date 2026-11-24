import { describe, it, expect } from "vitest";
import { generateCreatorToken, hashCreatorToken, verifyCreatorToken } from "@/lib/links/token";

describe("token: generateCreatorToken, hashCreatorToken, verifyCreatorToken", () => {
  it("generates a 43-character base64url token and 64-hex hash round-trip", () => {
    const pair = generateCreatorToken();
    expect(pair.token).toHaveLength(43);
    expect(pair.hash).toHaveLength(64);
    expect(pair.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.hash).toMatch(/^[0-9a-f]{64}$/);

    const computed = hashCreatorToken(pair.token);
    expect(computed).toBe(pair.hash);

    expect(verifyCreatorToken(pair.token, pair.hash)).toBe(true);
  });

  it("fails verification on wrong token or wrong hash", () => {
    const pair1 = generateCreatorToken();
    const pair2 = generateCreatorToken();

    expect(verifyCreatorToken(pair1.token, pair2.hash)).toBe(false);
    expect(verifyCreatorToken("invalid-token-12345678901234567890123456789", pair1.hash)).toBe(
      false,
    );
  });

  it("rejects malformed token inputs in hashCreatorToken", () => {
    // Too short / too long
    expect(hashCreatorToken("abc")).toBeNull();
    expect(hashCreatorToken("A".repeat(42))).toBeNull();
    expect(hashCreatorToken("A".repeat(44))).toBeNull();

    // Invalid base64url characters
    expect(hashCreatorToken("A".repeat(42) + "+")).toBeNull();
    expect(hashCreatorToken("A".repeat(42) + "/")).toBeNull();
    expect(hashCreatorToken("A".repeat(42) + "=")).toBeNull();

    // @ts-expect-error non-string
    expect(hashCreatorToken(null)).toBeNull();
  });

  it("verifyCreatorToken safely rejects null, undefined, or malformed storedHash", () => {
    const { token } = generateCreatorToken();

    expect(verifyCreatorToken(token, null)).toBe(false);
    expect(verifyCreatorToken(token, undefined)).toBe(false);
    expect(verifyCreatorToken(token, "")).toBe(false);
    expect(verifyCreatorToken(token, "short-hash")).toBe(false);
    expect(verifyCreatorToken(token, "g".repeat(64))).toBe(false); // non-hex
  });
});
