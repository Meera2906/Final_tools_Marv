/**
 * Trusted client IP extraction, salted IP hashing, and signed reporting session cookies.
 * DESIGN.md §10.2 & Amendment A4
 */

import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

export const REPORTING_COOKIE_NAME = "_mrv_rep_sess";
export const REPORTING_COOKIE_MAX_AGE_SECONDS = 7200; // 2 hours
const HKDF_INFO = "mrv-link-shortener-reporting-session-v1";
const DEV_FALLBACK_SALT = "dev_ip_hash_salt_do_not_use_in_prod_min_32_chars";

// Basic IPv4 & IPv6 format validation
const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_REGEX = /^[0-9a-fA-F:]+$/;

function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;
  const clean = ip.trim();
  if (IPV4_REGEX.test(clean)) {
    const parts = clean.split(".");
    return parts.every((p) => {
      const n = parseInt(p, 10);
      return n >= 0 && n <= 255;
    });
  }
  return IPV6_REGEX.test(clean) && clean.includes(":");
}

/**
 * Extracts trusted client IP from Netlify request headers.
 * In production, only the authoritative `x-nf-client-connection-ip` is trusted.
 * `x-forwarded-for` is strictly ignored in production to prevent IP spoofing.
 */
export function getClientIp(req: Request): string | null {
  const headers = req.headers;

  // 1. Authoritative Netlify edge header
  const netlifyIp = headers.get("x-nf-client-connection-ip");
  if (netlifyIp && isValidIp(netlifyIp)) {
    return netlifyIp.trim();
  }

  // 2. Fallback to x-forwarded-for ONLY in non-production environments
  if (process.env["NODE_ENV"] !== "production") {
    const xff = headers.get("x-forwarded-for");
    if (xff) {
      const firstIp = xff.split(",")[0]?.trim();
      if (firstIp && isValidIp(firstIp)) {
        return firstIp;
      }
    }
  }

  return null;
}

/**
 * Computes salted SHA-256 hash of an IP address.
 * Raw IPs are never stored in the database.
 */
export function hashIp(ip: string): string {
  const salt = process.env["IP_HASH_SALT"];
  if (!salt) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("Missing required IP_HASH_SALT environment variable");
    }
    return createHash("sha256")
      .update(DEV_FALLBACK_SALT + ip)
      .digest("hex");
  }
  return createHash("sha256")
    .update(salt + ip)
    .digest("hex");
}

/**
 * Derives a 32-byte session signing key using HKDF-SHA256.
 */
function getSessionKey(): Buffer {
  const sessionSecret = process.env["REPORTING_SESSION_SECRET"];
  if (sessionSecret) {
    return Buffer.from(sessionSecret, "utf-8");
  }
  const salt = process.env["IP_HASH_SALT"] || DEV_FALLBACK_SALT;
  return Buffer.from(hkdfSync("sha256", salt, Buffer.alloc(0), HKDF_INFO, 32));
}

/**
 * Issues a signed reporting session cookie with 2-hour lifetime.
 */
export function issueReportingCookie(): {
  sessionId: string;
  setCookie: string;
} {
  const rawBytes = crypto.getRandomValues(new Uint8Array(16));
  const sessionId = Buffer.from(rawBytes).toString("base64url");
  const expiresAt = Date.now() + REPORTING_COOKIE_MAX_AGE_SECONDS * 1000;

  const key = getSessionKey();
  const payload = `${sessionId}.${expiresAt}`;
  const hmacHex = createHmac("sha256", key).update(payload).digest("hex");

  const cookieVal = `${sessionId}.${expiresAt}.${hmacHex}`;
  const setCookie = `${REPORTING_COOKIE_NAME}=${cookieVal}; Path=/; Max-Age=${REPORTING_COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;

  return { sessionId, setCookie };
}

/**
 * Verifies a reporting session cookie and returns sessionId if valid and unexpired.
 * Returns null if missing, malformed, expired, or signature does not match.
 */
export function verifyReportingCookie(cookieHeader: string | null): { sessionId: string } | null {
  if (!cookieHeader || typeof cookieHeader !== "string") {
    return null;
  }

  const cookies = cookieHeader.split(";").map((c) => c.trim());
  const match = cookies.find((c) => c.startsWith(`${REPORTING_COOKIE_NAME}=`));
  if (!match) return null;

  const cookieVal = match.substring(`${REPORTING_COOKIE_NAME}=`.length);
  const parts = cookieVal.split(".");
  if (parts.length !== 3) return null;

  const [sessionId, expiresAtStr, hmacHex] = parts;
  if (!sessionId || !expiresAtStr || !hmacHex || hmacHex.length !== 64) {
    return null;
  }

  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || expiresAt <= Date.now()) {
    return null; // Expired
  }

  const key = getSessionKey();
  const payload = `${sessionId}.${expiresAtStr}`;
  const expectedHmacHex = createHmac("sha256", key).update(payload).digest("hex");

  const bufA = Buffer.from(hmacHex, "hex");
  const bufB = Buffer.from(expectedHmacHex, "hex");

  if (bufA.length !== bufB.length || !timingSafeEqual(bufA, bufB)) {
    return null; // Signature tampered
  }

  return { sessionId };
}

export type ReporterIdentity =
  { kind: "ip"; hash: string } | { kind: "session"; sessionId: string } | { kind: "none" };

/**
 * Resolves the client identity for abuse reporting.
 * Prefers trusted IP if available, falls back to signed session cookie, otherwise returns none.
 */
export function getReporterIdentity(req: Request): ReporterIdentity {
  const ip = getClientIp(req);
  if (ip) {
    return { kind: "ip", hash: hashIp(ip) };
  }

  const cookieHeader = req.headers.get("cookie");
  const session = verifyReportingCookie(cookieHeader);
  if (session) {
    return { kind: "session", sessionId: session.sessionId };
  }

  return { kind: "none" };
}
