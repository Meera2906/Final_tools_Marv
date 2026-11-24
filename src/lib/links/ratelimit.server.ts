/**
 * Server-side rate limiter using PostgreSQL atomic stored procedure `rate_limit_hit`.
 * DESIGN.md §6.3 & §10
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

export interface RateLimitOptions {
  /**
   * Whether to reject the request if the database rate limit call fails.
   * Recommended: true for create, password, and report; false for resolve.
   */
  failClosed?: boolean;
  /**
   * Optional Supabase client instance for unit testing and dependency injection.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any;
}

export const LIMITS = {
  createHour: { windowSeconds: 3600, limit: 10 },
  createMinute: { windowSeconds: 60, limit: 5 },
  resolve: { windowSeconds: 60, limit: 120 },
  password: { windowSeconds: 900, limit: 5 }, // 5 attempts per 15 min per code+ip
  report: { windowSeconds: 3600, limit: 5 }, // 5 reports per hour per verified IP
  reportSession: { windowSeconds: 3600, limit: 2 }, // 2 reports per hour per session
  creatorManage: { windowSeconds: 60, limit: 60 }, // 60 requests per minute per IP
} as const;

/**
 * Checks and records a rate limit hit for a given key and fixed window.
 */
export async function rateLimit(
  key: string,
  windowSeconds: number,
  limit: number,
  opts?: RateLimitOptions,
): Promise<RateLimitResult> {
  const failClosed = opts?.failClosed ?? false;

  try {
    const db = opts?.db ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;

    const { data, error } = await db.rpc("rate_limit_hit", {
      p_key: key,
      p_window_seconds: windowSeconds,
      p_limit: limit,
    });

    if (error || !data || data.length === 0) {
      if (failClosed) {
        return { allowed: false, remaining: 0, retryAfter: windowSeconds };
      }
      return { allowed: true, remaining: 1, retryAfter: 0 };
    }

    const row = data[0];
    return {
      allowed: Boolean(row.allowed),
      remaining: typeof row.remaining === "number" ? row.remaining : 0,
      retryAfter: typeof row.retry_after === "number" ? row.retry_after : 0,
    };
  } catch (err) {
    if (failClosed) {
      return { allowed: false, remaining: 0, retryAfter: windowSeconds };
    }
    return { allowed: true, remaining: 1, retryAfter: 0 };
  }
}
