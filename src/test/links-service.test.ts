import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createShortLinkService,
  resolveShortLinkService,
  getLinkInfoService,
  updateLinkService,
  disableLinkService,
  reportLinkService,
} from "@/lib/links/service.server";
import { hashPassword } from "@/lib/links/password";
import { generateCreatorToken } from "@/lib/links/token";

// In-memory fake database harness
function createMockDb() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shortLinks = new Map<string, any>();
  const blockedDomains = new Set<string>(["malware.test", "phishing.test"]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linkReports: any[] = [];
  let registeredClicks: string[] = [];

  const db = {
    _shortLinks: shortLinks,
    _blockedDomains: blockedDomains,
    _linkReports: linkReports,
    getRegisteredClicks: () => registeredClicks,
    resetClicks: () => {
      registeredClicks = [];
    },

    from: (table: string) => {
      if (table === "short_links") {
        let selectedFields: string | null = null;
        let filterCode: string | null = null;

        const query = {
          select: (fields: string) => {
            selectedFields = fields;
            return query;
          },
          eq: (col: string, val: string) => {
            if (col === "code") filterCode = val;
            return query;
          },
          maybeSingle: async () => {
            if (!filterCode || !shortLinks.has(filterCode)) {
              return { data: null, error: null };
            }
            const row = { ...shortLinks.get(filterCode) };
            return { data: row, error: null };
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          insert: async (row: any) => {
            if (shortLinks.has(row.code)) {
              return { error: { code: "23505", message: "unique violation" } };
            }
            shortLinks.set(row.code, {
              ...row,
              clicks: 0,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              last_clicked_at: null,
            });
            return { error: null };
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          update: (updates: any) => {
            return {
              eq: async (col: string, val: string) => {
                if (col === "code" && shortLinks.has(val)) {
                  const existing = shortLinks.get(val);
                  shortLinks.set(val, { ...existing, ...updates });
                  return { error: null };
                }
                return { error: null };
              },
            };
          },
        };
        return query;
      }

      if (table === "blocked_domains") {
        return {
          select: async () => {
            return {
              data: Array.from(blockedDomains).map((domain) => ({ domain })),
              error: null,
            };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: async (fn: string, params: any) => {
      if (fn === "register_click") {
        registeredClicks.push(params.p_code);
        const row = shortLinks.get(params.p_code);
        if (row && (row.status === "active" || row.status === "pending_review")) {
          row.clicks = (row.clicks || 0) + 1;
          row.last_clicked_at = new Date().toISOString();
        }
        return { data: null, error: null };
      }

      if (fn === "submit_link_report") {
        const { p_code, p_reason, p_details, p_reporter_hash } = params;
        const link = shortLinks.get(p_code);
        if (!link) {
          return { data: [{ ok: false, already_reported: false, escalated: false }], error: null };
        }

        // Deduplication
        const exists = linkReports.some(
          (r) => r.code === p_code && r.reporter_hash === p_reporter_hash,
        );
        if (exists) {
          return { data: [{ ok: true, already_reported: true, escalated: false }], error: null };
        }

        linkReports.push({
          code: p_code,
          reason: p_reason,
          details: p_details,
          reporter_hash: p_reporter_hash,
          status: "open",
        });

        // Threshold check: 3 verified reports
        const openVerified = linkReports.filter(
          (r) =>
            r.code === p_code && r.status === "open" && !r.reporter_hash.startsWith("unverified:"),
        );

        let escalated = false;
        if (openVerified.length >= 3 && link.status === "active") {
          link.status = "pending_review";
          escalated = true;
        }

        return {
          data: [{ ok: true, already_reported: false, escalated }],
          error: null,
        };
      }

      throw new Error(`Unexpected RPC: ${fn}`);
    },
  };

  return db;
}

describe("links.service: core server functions", () => {
  let mockDb: ReturnType<typeof createMockDb>;
  const baseRateLimit = vi.fn().mockResolvedValue({ allowed: true, remaining: 10, retryAfter: 0 });

  beforeEach(() => {
    mockDb = createMockDb();
    baseRateLimit.mockClear();
    process.env["IP_HASH_SALT"] = "test_ip_hash_salt_32_characters_long_min";
  });

  describe("createShortLinkService", () => {
    it("creates a link on the happy path", async () => {
      const res = await createShortLinkService(
        { url: "https://example.com/target-path" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.code).toMatch(/^[0-9A-Za-z]{7}$/);
        expect(res.creatorToken).toHaveLength(43);

        const stored = mockDb._shortLinks.get(res.code);
        expect(stored).toBeDefined();
        expect(stored.url).toBe("https://example.com/target-path");
        expect(stored.target_host).toBe("example.com");
        expect(stored.status).toBe("active");
        expect(stored.password_hash).toBeNull();
      }
    });

    it("creates a password-protected link with expiry", async () => {
      const future = new Date(Date.now() + 86400e3).toISOString();
      const res = await createShortLinkService(
        {
          url: "https://example.com/protected",
          code: "my-custom-code",
          password: "mypassword123",
          expiresAt: future,
        },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.code).toBe("my-custom-code");
        const stored = mockDb._shortLinks.get("my-custom-code");
        expect(stored.password_hash).toMatch(/^pbkdf2\$sha256\$/);
        expect(stored.expires_at).toBe(new Date(future).toISOString());
      }
    });

    it("rejects reserved custom slugs", async () => {
      const res = await createShortLinkService(
        { url: "https://example.com", code: "admin" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("reserved");
      }
    });

    it("returns taken when custom slug already exists", async () => {
      await createShortLinkService(
        { url: "https://example.com", code: "custom-link" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );

      const res2 = await createShortLinkService(
        { url: "https://example.com/different", code: "custom-link" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );

      expect(res2.ok).toBe(false);
      if (!res2.ok) {
        expect(res2.error).toBe("taken");
      }
    });

    it("rejects invalid URLs and SSFR loopback targets", async () => {
      const badUrls = [
        "javascript:alert(1)",
        "http://127.0.0.1/evil",
        "http://localhost:3000",
        "not a url",
      ];
      for (const url of badUrls) {
        const res = await createShortLinkService(
          { url },
          { db: mockDb, rateLimitFn: baseRateLimit },
        );
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.error).toBe("invalid_url");
        }
      }
    });

    it("rejects URLs from blocked domains", async () => {
      const res = await createShortLinkService(
        { url: "https://sub.malware.test/download" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("blocked_domain");
      }
    });

    it("flags punycode/homograph domains as pending_review", async () => {
      const res = await createShortLinkService(
        { url: "https://xn--e1afmkfd.xn--p1ai/path" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        const stored = mockDb._shortLinks.get(res.code);
        expect(stored.status).toBe("pending_review");
      }
    });

    it("enforces rate limits on link creation", async () => {
      const blockedRl = vi.fn().mockResolvedValue({
        allowed: false,
        remaining: 0,
        retryAfter: 3500,
      });

      const res = await createShortLinkService(
        { url: "https://example.com" },
        { db: mockDb, rateLimitFn: blockedRl },
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("rate_limited");
        expect(res.retryAfter).toBe(3500);
      }
    });
  });

  describe("resolveShortLinkService", () => {
    it("resolves active public link and registers click count", async () => {
      mockDb._shortLinks.set("test-link", {
        code: "test-link",
        url: "https://example.com/destination",
        status: "active",
        clicks: 0,
        target_host: "example.com",
      });

      const res = await resolveShortLinkService(
        { code: "test-link" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );

      expect(res.status).toBe("ok");
      if (res.status === "ok") {
        expect(res.url).toBe("https://example.com/destination");
      }
      expect(mockDb.getRegisteredClicks()).toContain("test-link");
      expect(mockDb._shortLinks.get("test-link").clicks).toBe(1);
    });

    it("handles password protection states", async () => {
      const pwHash = await hashPassword("pass123");
      mockDb._shortLinks.set("pw-link", {
        code: "pw-link",
        url: "https://example.com/secret",
        status: "active",
        password_hash: pwHash,
      });

      // No password provided
      const resPrompt = await resolveShortLinkService(
        { code: "pw-link" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(resPrompt.status).toBe("password");

      // Wrong password provided
      const resWrong = await resolveShortLinkService(
        { code: "pw-link", password: "wrong" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(resWrong.status).toBe("wrong");

      // Correct password provided
      const resSuccess = await resolveShortLinkService(
        { code: "pw-link", password: "pass123" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(resSuccess.status).toBe("ok");
      if (resSuccess.status === "ok") {
        expect(resSuccess.url).toBe("https://example.com/secret");
      }
    });

    it("does NOT disclose URL on pending_review password-protected link before unlock", async () => {
      const pwHash = await hashPassword("pass123");
      mockDb._shortLinks.set("flagged-pw", {
        code: "flagged-pw",
        url: "https://example.com/sensitive",
        status: "pending_review",
        password_hash: pwHash,
      });

      const res = await resolveShortLinkService(
        { code: "flagged-pw" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(res.status).toBe("password_pending_review");
      // @ts-expect-error verifying no url on password_pending_review
      expect(res.url).toBeUndefined();

      // Once unlocked with password, returns pending_review with url for interstitial
      const resUnlocked = await resolveShortLinkService(
        { code: "flagged-pw", password: "pass123" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(resUnlocked.status).toBe("pending_review");
      if (resUnlocked.status === "pending_review") {
        expect(resUnlocked.url).toBe("https://example.com/sensitive");
      }
    });

    it("evaluates expired, missing, disabled, and blocked statuses", async () => {
      // Missing
      expect(
        (
          await resolveShortLinkService(
            { code: "nonexistent" },
            { db: mockDb, rateLimitFn: baseRateLimit },
          )
        ).status,
      ).toBe("missing");

      // Expired
      mockDb._shortLinks.set("exp-link", {
        code: "exp-link",
        url: "https://example.com",
        status: "active",
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
      expect(
        (
          await resolveShortLinkService(
            { code: "exp-link" },
            { db: mockDb, rateLimitFn: baseRateLimit },
          )
        ).status,
      ).toBe("expired");

      // Disabled
      mockDb._shortLinks.set("dis-link", {
        code: "dis-link",
        url: "https://example.com",
        status: "disabled",
      });
      expect(
        (
          await resolveShortLinkService(
            { code: "dis-link" },
            { db: mockDb, rateLimitFn: baseRateLimit },
          )
        ).status,
      ).toBe("disabled");

      // Blocked
      mockDb._shortLinks.set("blk-link", {
        code: "blk-link",
        url: "https://example.com",
        status: "blocked",
      });
      expect(
        (
          await resolveShortLinkService(
            { code: "blk-link" },
            { db: mockDb, rateLimitFn: baseRateLimit },
          )
        ).status,
      ).toBe("blocked");
    });

    it("dynamically re-checks target host against blocked domains at resolve time", async () => {
      mockDb._shortLinks.set("dyn-block", {
        code: "dyn-block",
        url: "https://malware.test/bad",
        target_host: "malware.test",
        status: "active",
      });

      const res = await resolveShortLinkService(
        { code: "dyn-block" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(res.status).toBe("blocked");
      expect(mockDb._shortLinks.get("dyn-block").status).toBe("blocked");
    });
  });

  describe("getLinkInfoService, updateLinkService, disableLinkService", () => {
    it("authorizes creator with creatorToken and returns link metadata", async () => {
      const { token, hash } = generateCreatorToken();
      mockDb._shortLinks.set("meta-link", {
        code: "meta-link",
        url: "https://example.com/page",
        status: "active",
        clicks: 42,
        creator_token_hash: hash,
        password_hash: "some_pw",
        created_at: new Date().toISOString(),
        expires_at: null,
        last_clicked_at: null,
      });

      // Wrong token
      const resBad = await getLinkInfoService(
        { code: "meta-link", creatorToken: "wrong_token_1234567890123456789012345678901" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(resBad.ok).toBe(false);
      if (!resBad.ok) expect(resBad.error).toBe("unauthorized");

      // Correct token
      const resGood = await getLinkInfoService(
        { code: "meta-link", creatorToken: token },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(resGood.ok).toBe(true);
      if (resGood.ok) {
        expect(resGood.link.code).toBe("meta-link");
        expect(resGood.link.clicks).toBe(42);
        expect(resGood.link.hasPassword).toBe(true);
        // Sensitive hashes must not be disclosed
        // @ts-expect-error verifying no leak
        expect(resGood.link.creator_token_hash).toBeUndefined();
        // @ts-expect-error verifying no leak
        expect(resGood.link.password_hash).toBeUndefined();
      }
    });

    it("allows creator to toggle status, update/clear expiry and password", async () => {
      const { token, hash } = generateCreatorToken();
      mockDb._shortLinks.set("up-link", {
        code: "up-link",
        url: "https://example.com",
        status: "active",
        creator_token_hash: hash,
      });

      // Disable
      const resDis = await disableLinkService(
        { code: "up-link", creatorToken: token },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(resDis.ok).toBe(true);
      expect(mockDb._shortLinks.get("up-link").status).toBe("disabled");

      // Update expiry and password
      const future = new Date(Date.now() + 7200e3).toISOString();
      const resUp = await updateLinkService(
        {
          code: "up-link",
          creatorToken: token,
          status: "active",
          expiresAt: future,
          password: "new-password",
        },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(resUp.ok).toBe(true);
      if (resUp.ok) {
        expect(resUp.link.status).toBe("active");
        expect(resUp.link.hasPassword).toBe(true);
      }

      // Clear password and expiry
      const resClear = await updateLinkService(
        {
          code: "up-link",
          creatorToken: token,
          expiresAt: null,
          password: null,
        },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(resClear.ok).toBe(true);
      if (resClear.ok) {
        expect(resClear.link.expiresAt).toBeNull();
        expect(resClear.link.hasPassword).toBe(false);
      }
    });

    it("prevents creator from touching blocked or pending_review links", async () => {
      const { token, hash } = generateCreatorToken();
      mockDb._shortLinks.set("flagged-link", {
        code: "flagged-link",
        url: "https://example.com",
        status: "pending_review",
        creator_token_hash: hash,
      });

      const res = await updateLinkService(
        { code: "flagged-link", creatorToken: token, status: "active" },
        { db: mockDb, rateLimitFn: baseRateLimit },
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("forbidden_status_transition");
      }
    });
  });

  describe("reportLinkService", () => {
    it("submits reports from verified IP and triggers escalation at threshold 3", async () => {
      mockDb._shortLinks.set("rep-link", {
        code: "rep-link",
        url: "https://example.com/spam",
        status: "active",
      });

      const reqA = new Request("https://example.com", {
        headers: { "x-nf-client-connection-ip": "203.0.113.1" },
      });
      const reqB = new Request("https://example.com", {
        headers: { "x-nf-client-connection-ip": "203.0.113.2" },
      });
      const reqC = new Request("https://example.com", {
        headers: { "x-nf-client-connection-ip": "203.0.113.3" },
      });

      // Report 1
      const res1 = await reportLinkService(
        { code: "rep-link", reason: "spam", details: "Spam link" },
        { db: mockDb, req: reqA, rateLimitFn: baseRateLimit },
      );
      expect(res1.ok).toBe(true);
      expect(mockDb._shortLinks.get("rep-link").status).toBe("active");

      // Duplicate report from reporter A
      const resDup = await reportLinkService(
        { code: "rep-link", reason: "spam", details: "Spam duplicate" },
        { db: mockDb, req: reqA, rateLimitFn: baseRateLimit },
      );
      expect(resDup.ok).toBe(true);
      if (resDup.ok) expect(resDup.alreadyReported).toBe(true);
      expect(mockDb._shortLinks.get("rep-link").status).toBe("active");

      // Report 2
      const res2 = await reportLinkService(
        { code: "rep-link", reason: "phishing" },
        { db: mockDb, req: reqB, rateLimitFn: baseRateLimit },
      );
      expect(res2.ok).toBe(true);
      expect(mockDb._shortLinks.get("rep-link").status).toBe("active");

      // Report 3 -> Escalation
      const res3 = await reportLinkService(
        { code: "rep-link", reason: "malware" },
        { db: mockDb, req: reqC, rateLimitFn: baseRateLimit },
      );
      expect(res3.ok).toBe(true);
      expect(mockDb._shortLinks.get("rep-link").status).toBe("pending_review");
    });

    it("unverified reports are accepted but do not trigger threshold escalation", async () => {
      mockDb._shortLinks.set("unv-link", {
        code: "unv-link",
        url: "https://example.com",
        status: "active",
      });

      // Mock identity as session
      const getIdentityMock = vi
        .fn()
        .mockReturnValueOnce({ kind: "session", sessionId: "sess_1" })
        .mockReturnValueOnce({ kind: "session", sessionId: "sess_2" })
        .mockReturnValueOnce({ kind: "session", sessionId: "sess_3" });

      const fakeReq = new Request("https://example.com");

      // 3 unverified reports
      await reportLinkService(
        { code: "unv-link", reason: "spam" },
        { db: mockDb, req: fakeReq, rateLimitFn: baseRateLimit, getIdentityFn: getIdentityMock },
      );
      await reportLinkService(
        { code: "unv-link", reason: "spam" },
        { db: mockDb, req: fakeReq, rateLimitFn: baseRateLimit, getIdentityFn: getIdentityMock },
      );
      await reportLinkService(
        { code: "unv-link", reason: "spam" },
        { db: mockDb, req: fakeReq, rateLimitFn: baseRateLimit, getIdentityFn: getIdentityMock },
      );

      // Link must remain active!
      expect(mockDb._shortLinks.get("unv-link").status).toBe("active");
    });

    it("rejects reports when client is unverified (no IP, no session cookie)", async () => {
      const fakeReq = new Request("https://example.com");
      const res = await reportLinkService(
        { code: "any-link", reason: "spam" },
        {
          db: mockDb,
          req: fakeReq,
          rateLimitFn: baseRateLimit,
          getIdentityFn: () => ({ kind: "none" }),
        },
      );
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("unverified_client");
      }
    });
  });
});
