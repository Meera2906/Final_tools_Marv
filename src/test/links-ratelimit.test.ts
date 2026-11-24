import { describe, it, expect, vi } from "vitest";
import { rateLimit, LIMITS } from "@/lib/links/ratelimit.server";

describe("ratelimit.server: rateLimit & LIMITS", () => {
  it("exports valid standard limit configurations", () => {
    expect(LIMITS.createHour).toEqual({ windowSeconds: 3600, limit: 10 });
    expect(LIMITS.createMinute).toEqual({ windowSeconds: 60, limit: 5 });
    expect(LIMITS.resolve).toEqual({ windowSeconds: 60, limit: 120 });
    expect(LIMITS.password).toEqual({ windowSeconds: 900, limit: 5 });
    expect(LIMITS.report).toEqual({ windowSeconds: 3600, limit: 5 });
    expect(LIMITS.reportSession).toEqual({ windowSeconds: 3600, limit: 2 });
    expect(LIMITS.creatorManage).toEqual({ windowSeconds: 60, limit: 60 });
  });

  it("returns allowed result from successful RPC execution", async () => {
    const mockDb = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ allowed: true, remaining: 4, retry_after: 0 }],
        error: null,
      }),
    };

    const res = await rateLimit("test:key", 60, 5, { db: mockDb });
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(4);
    expect(res.retryAfter).toBe(0);
    expect(mockDb.rpc).toHaveBeenCalledWith("rate_limit_hit", {
      p_key: "test:key",
      p_window_seconds: 60,
      p_limit: 5,
    });
  });

  it("returns blocked result when limit is exceeded", async () => {
    const mockDb = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ allowed: false, remaining: 0, retry_after: 42 }],
        error: null,
      }),
    };

    const res = await rateLimit("test:key", 60, 5, { db: mockDb });
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.retryAfter).toBe(42);
  });

  it("implements fail-open policy for resolve operations on DB error", async () => {
    const mockDb = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: new Error("DB down"),
      }),
    };

    // Default is fail-open
    const res = await rateLimit("test:key", 60, 100, {
      db: mockDb,
      failClosed: false,
    });
    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(1);
    expect(res.retryAfter).toBe(0);
  });

  it("implements fail-closed policy for sensitive operations on DB error", async () => {
    const mockDb = {
      rpc: vi.fn().mockRejectedValue(new Error("Connection timeout")),
    };

    const res = await rateLimit("test:sensitive", 3600, 10, {
      db: mockDb,
      failClosed: true,
    });
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.retryAfter).toBe(3600);
  });
});
