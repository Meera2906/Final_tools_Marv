import { describe, it, expect } from "vitest";
import { generateSlug, generateUniqueSlug, SlugCollisionError } from "@/lib/links/slug";

describe("slug: generateSlug and generateUniqueSlug", () => {
  it("generates 7-character base62 slugs by default", () => {
    const slug = generateSlug();
    expect(slug).toHaveLength(7);
    expect(slug).toMatch(/^[0-9A-Za-z]{7}$/);
  });

  it("respects custom length parameter", () => {
    expect(generateSlug(3)).toHaveLength(3);
    expect(generateSlug(10)).toHaveLength(10);
    expect(generateSlug(0)).toBe("");
  });

  it("uses rejection sampling and custom rng correctly", () => {
    // Provide bytes: 250 (rejected >= 248), 61 ('z'), 0 ('0'), 10 ('A')
    const sequence = [250, 61, 0, 10];
    let idx = 0;
    const mockRng = (n: number) => {
      const arr = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        arr[i] = sequence[idx++ % sequence.length] ?? 0;
      }
      return arr;
    };

    const slug = generateSlug(3, mockRng);
    expect(slug).toBe("z0A");
  });

  it("generateUniqueSlug succeeds when not taken", async () => {
    const isTaken = async () => false;
    const slug = await generateUniqueSlug(isTaken);
    expect(slug).toHaveLength(7);
  });

  it("generateUniqueSlug retries on collision and succeeds", async () => {
    let callCount = 0;
    const isTaken = async () => {
      callCount++;
      return callCount < 3; // First 2 taken, 3rd available
    };

    const slug = await generateUniqueSlug(isTaken, 5);
    expect(slug).toHaveLength(7);
    expect(callCount).toBe(3);
  });

  it("generateUniqueSlug throws SlugCollisionError after maxAttempts", async () => {
    const alwaysTaken = async () => true;
    await expect(generateUniqueSlug(alwaysTaken, 5)).rejects.toThrow(SlugCollisionError);
  });
});
