import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, DEFAULT_ITERATIONS } from "@/lib/links/password";

describe("password: hashPassword and verifyPassword", () => {
  it("creates and verifies a standard password hash round-trip", async () => {
    const pw = "super-secret-password-123";
    const start = performance.now();
    const hash = await hashPassword(pw);
    const hashDuration = performance.now() - start;

    expect(hash).toMatch(/^pbkdf2\$sha256\$300000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
    expect(hashDuration).toBeGreaterThan(0);

    const verifyStart = performance.now();
    const result = await verifyPassword(pw, hash);
    const verifyDuration = performance.now() - verifyStart;

    expect(result.ok).toBe(true);
    expect(result.needsUpgrade).toBe(false);
    expect(verifyDuration).toBeGreaterThan(0);
  });

  it("fails verification on wrong password", async () => {
    const hash = await hashPassword("correct-horse-battery");
    const result = await verifyPassword("wrong-password", hash);
    expect(result.ok).toBe(false);
    expect(result.needsUpgrade).toBe(false);
  });

  it("verifies legacy format (100,000 iterations salt:hash) and flags needsUpgrade", async () => {
    // Generate legacy style hash using 100k iters
    const pw = "legacy-admin-pass";
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = [...saltBytes].map((b) => b.toString(16).padStart(2, "0")).join("");

    // Create legacy hash string
    const fullHash = await hashPassword(pw, saltBytes, 100_000);
    const parts = fullHash.split("$");
    const legacyFormat = `${parts[3]}:${parts[4]}`;

    const res = await verifyPassword(pw, legacyFormat);
    expect(res.ok).toBe(true);
    expect(res.needsUpgrade).toBe(true);

    const wrongRes = await verifyPassword("wrong", legacyFormat);
    expect(wrongRes.ok).toBe(false);
    expect(wrongRes.needsUpgrade).toBe(false);
  });

  it("flags needsUpgrade for pbkdf2 with lower iterations (< 300,000)", async () => {
    const pw = "older-standard-pass";
    const lowerIterHash = await hashPassword(pw, undefined, 150_000);
    expect(lowerIterHash).toContain("150000");

    const res = await verifyPassword(pw, lowerIterHash);
    expect(res.ok).toBe(true);
    expect(res.needsUpgrade).toBe(true);
  });

  it("gracefully rejects malformed or non-string inputs without throwing", async () => {
    const malformed = [
      "",
      "not-a-hash",
      "pbkdf2$sha256$bad",
      "pbkdf2$sha256$100$short$short",
      "123:456",
      "pbkdf2$sha256$300000$zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz$zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    ];

    for (const bad of malformed) {
      const res = await verifyPassword("any-pass", bad);
      expect(res.ok).toBe(false);
      expect(res.needsUpgrade).toBe(false);
    }

    // @ts-expect-error non-string tests
    expect((await verifyPassword(null, "valid")).ok).toBe(false);
    // @ts-expect-error non-string tests
    expect((await verifyPassword("pw", null)).ok).toBe(false);
  });
});
