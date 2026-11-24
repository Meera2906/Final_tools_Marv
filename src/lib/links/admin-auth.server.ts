/**
 * Server-side admin authentication and error formatting.
 * DESIGN.md §7.2
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { getClientIp, hashIp } from "./ip.server";
import { LIMITS, rateLimit, type RateLimitResult } from "./ratelimit.server";

export interface AdminAuthDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any;
  req?: Request;
  adminApiKey?: string;
  rateLimitFn?: (
    key: string,
    windowSeconds: number,
    limit: number,
    opts?: { failClosed?: boolean; db?: unknown },
  ) => Promise<RateLimitResult>;
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(extraHeaders ?? {}),
    },
  });
}

export type AdminAuthResult = { ok: true; ipHash: string } | { ok: false; response: Response };

/**
 * Validates the x-admin-api-key header in constant time using SHA-256 digests.
 * Rejects with 500 if server key is unconfigured or empty.
 * Rejects with 401 on missing or incorrect keys, with rate limiting on failed attempts.
 */
export async function requireAdminAuth(
  req: Request,
  deps?: AdminAuthDeps,
): Promise<AdminAuthResult> {
  const ip = getClientIp(req);
  const ipHash = ip ? hashIp(ip) : "anonymous";
  const rl = deps?.rateLimitFn ?? rateLimit;
  const db = deps?.db;

  const configuredKey =
    deps?.adminApiKey !== undefined ? deps.adminApiKey : process.env["ADMIN_API_KEY"];

  // 1. Unset, undefined, or empty key must fail with 500 (never allow empty to match)
  if (!configuredKey || configuredKey.trim().length === 0) {
    return {
      ok: false,
      response: jsonResponse(
        {
          error: {
            code: "server_misconfigured",
            message: "Admin authentication is not configured on the server.",
          },
        },
        500,
      ),
    };
  }

  const providedKey = req.headers.get("x-admin-api-key");

  // 2. Missing or blank provided key
  if (!providedKey || providedKey.trim().length === 0) {
    const rlRes = await rl(
      `admin_failed:${ipHash}`,
      LIMITS.adminFailed.windowSeconds,
      LIMITS.adminFailed.limit,
      { failClosed: true, db },
    );

    if (!rlRes.allowed) {
      return {
        ok: false,
        response: jsonResponse(
          {
            error: {
              code: "rate_limited",
              message: "Too many failed admin authentication attempts. Try again later.",
            },
          },
          429,
          { "Retry-After": String(rlRes.retryAfter) },
        ),
      };
    }

    return {
      ok: false,
      response: jsonResponse(
        {
          error: {
            code: "unauthorized",
            message: "Missing or invalid admin API key.",
          },
        },
        401,
      ),
    };
  }

  // 3. Constant-time digest comparison to avoid leaking key length or timing
  const expectedDigest = createHash("sha256").update(configuredKey).digest();
  const providedDigest = createHash("sha256").update(providedKey).digest();
  const isMatch = timingSafeEqual(expectedDigest, providedDigest);

  if (!isMatch) {
    const rlRes = await rl(
      `admin_failed:${ipHash}`,
      LIMITS.adminFailed.windowSeconds,
      LIMITS.adminFailed.limit,
      { failClosed: true, db },
    );

    if (!rlRes.allowed) {
      return {
        ok: false,
        response: jsonResponse(
          {
            error: {
              code: "rate_limited",
              message: "Too many failed admin authentication attempts. Try again later.",
            },
          },
          429,
          { "Retry-After": String(rlRes.retryAfter) },
        ),
      };
    }

    return {
      ok: false,
      response: jsonResponse(
        {
          error: {
            code: "unauthorized",
            message: "Missing or invalid admin API key.",
          },
        },
        401,
      ),
    };
  }

  return { ok: true, ipHash };
}
