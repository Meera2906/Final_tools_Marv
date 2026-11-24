import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getClientIp,
  hashIp,
  issueReportingCookie,
  verifyReportingCookie,
  getReporterIdentity,
  REPORTING_COOKIE_NAME,
} from "@/lib/links/ip.server";

describe("ip.server: client IP and reporting session", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.IP_HASH_SALT = "test_ip_hash_salt_32_characters_long_min";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("getClientIp", () => {
    it("extracts authoritative x-nf-client-connection-ip", () => {
      const req = new Request("https://example.com", {
        headers: { "x-nf-client-connection-ip": "203.0.113.195" },
      });
      expect(getClientIp(req)).toBe("203.0.113.195");
    });

    it("falls back to x-forwarded-for in development/test", () => {
      process.env.NODE_ENV = "development";
      const req = new Request("https://example.com", {
        headers: { "x-forwarded-for": "198.51.100.22, 10.0.0.1" },
      });
      expect(getClientIp(req)).toBe("198.51.100.22");
    });

    it("strictly ignores x-forwarded-for in production", () => {
      process.env.NODE_ENV = "production";
      const req = new Request("https://example.com", {
        headers: { "x-forwarded-for": "198.51.100.22" },
      });
      expect(getClientIp(req)).toBeNull();
    });

    it("handles IPv6 addresses properly", () => {
      const req = new Request("https://example.com", {
        headers: { "x-nf-client-connection-ip": "2001:db8::1" },
      });
      expect(getClientIp(req)).toBe("2001:db8::1");
    });
  });

  describe("hashIp", () => {
    it("computes deterministic SHA-256 salted hash", () => {
      const hash1 = hashIp("203.0.113.1");
      const hash2 = hashIp("203.0.113.1");
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
      expect(hash1).not.toBe(hashIp("203.0.113.2"));
    });

    it("throws clear configuration error in production if IP_HASH_SALT is missing", () => {
      process.env.NODE_ENV = "production";
      delete process.env.IP_HASH_SALT;
      expect(() => hashIp("203.0.113.1")).toThrow("Missing required IP_HASH_SALT");
    });
  });

  describe("reporting session cookie", () => {
    it("issues and verifies a valid reporting cookie round-trip", () => {
      const { sessionId, setCookie } = issueReportingCookie();
      expect(sessionId).toBeTruthy();
      expect(setCookie).toContain(`${REPORTING_COOKIE_NAME}=`);
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("Secure");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Max-Age=7200");

      const cookieVal = setCookie.split(";")[0];
      const verified = verifyReportingCookie(cookieVal);
      expect(verified).not.toBeNull();
      expect(verified?.sessionId).toBe(sessionId);
    });

    it("rejects tampered signature", () => {
      const { setCookie } = issueReportingCookie();
      const cookieVal = setCookie.split(";")[0];
      const parts = cookieVal.split(".");
      // Tamper last hex character
      const tamperedHex = parts[2].slice(0, -1) + (parts[2].endsWith("0") ? "1" : "0");
      const tamperedCookie = `${parts[0]}.${parts[1]}.${tamperedHex}`;

      expect(verifyReportingCookie(tamperedCookie)).toBeNull();
    });

    it("rejects expired cookie", () => {
      const { setCookie } = issueReportingCookie();
      const cookieVal = setCookie.split(";")[0];

      // Fast-forward time past 2 hours
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now + 7300 * 1000);

      expect(verifyReportingCookie(cookieVal)).toBeNull();
      vi.restoreAllMocks();
    });

    it("rejects missing or malformed cookie header", () => {
      expect(verifyReportingCookie(null)).toBeNull();
      expect(verifyReportingCookie("")).toBeNull();
      expect(verifyReportingCookie("other_cookie=123")).toBeNull();
      expect(verifyReportingCookie(`${REPORTING_COOKIE_NAME}=invalid`)).toBeNull();
    });
  });

  describe("getReporterIdentity", () => {
    it("returns ip identity when trusted IP is present", () => {
      const req = new Request("https://example.com", {
        headers: { "x-nf-client-connection-ip": "203.0.113.50" },
      });
      const id = getReporterIdentity(req);
      expect(id.kind).toBe("ip");
      if (id.kind === "ip") {
        expect(id.hash).toBe(hashIp("203.0.113.50"));
      }
    });

    it("returns session identity when trusted IP is absent but cookie is valid", () => {
      const { sessionId, setCookie } = issueReportingCookie();
      const cookieHeader = setCookie.split(";")[0];

      const req = new Request("https://example.com", {
        headers: { cookie: cookieHeader },
      });
      const id = getReporterIdentity(req);
      expect(id.kind).toBe("session");
      if (id.kind === "session") {
        expect(id.sessionId).toBe(sessionId);
      }
    });

    it("returns none identity when neither IP nor valid cookie exists", () => {
      const req = new Request("https://example.com");
      const id = getReporterIdentity(req);
      expect(id.kind).toBe("none");
    });
  });
});
