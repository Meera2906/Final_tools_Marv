import { describe, it, expect } from "vitest";
import {
  decideRedirect,
  validatePostOrigin,
  type RedirectLinkState,
} from "@/lib/links/redirect-decision";
import { handleGoPostService } from "@/lib/links/service.server";
import { hashPassword } from "@/lib/links/password";

describe("redirect-decision: decideRedirect matrix", () => {
  const activeLink: RedirectLinkState = {
    status: "active",
    url: "https://example.com/target",
    target_host: "example.com",
    expires_at: null,
    password_hash: null,
  };

  it("decides 302 redirect on clean active hit", () => {
    const res = decideRedirect({ code: "clean-link", link: activeLink });
    expect(res.kind).toBe("redirect");
    if (res.kind === "redirect") {
      expect(res.status).toBe(302);
      expect(res.url).toBe("https://example.com/target");
      expect(res.headers["Location"]).toBe("https://example.com/target");
      expect(res.headers["Cache-Control"]).toBe("no-store");
      expect(res.headers["Referrer-Policy"]).toBe("no-referrer");
      expect(res.headers["X-Robots-Tag"]).toBe("noindex");
    }
  });

  it("decides 404 missing when link is null", () => {
    const res = decideRedirect({ code: "missing-link", link: null });
    expect(res.kind).toBe("missing");
    expect(res.status).toBe(404);
  });

  it("decides 410 on expired link", () => {
    const res = decideRedirect({
      code: "exp-link",
      link: {
        ...activeLink,
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
    });
    expect(res.kind).toBe("expired");
    expect(res.status).toBe(410);
  });

  it("decides 410 on disabled link", () => {
    const res = decideRedirect({
      code: "dis-link",
      link: { ...activeLink, status: "disabled" },
    });
    expect(res.kind).toBe("disabled");
    expect(res.status).toBe(410);
  });

  it("decides 410 on blocked link or blocked domain", () => {
    const res1 = decideRedirect({
      code: "blk-link",
      link: { ...activeLink, status: "blocked" },
    });
    expect(res1.kind).toBe("blocked");
    expect(res1.status).toBe(410);

    const res2 = decideRedirect({
      code: "blk-link-2",
      link: activeLink,
      isHostBlocked: true,
    });
    expect(res2.kind).toBe("blocked");
    expect(res2.status).toBe(410);
  });

  it("decides 429 when rate limit is exceeded", () => {
    const res = decideRedirect({
      code: "any-link",
      link: activeLink,
      rateLimitAllowed: false,
      retryAfter: 45,
    });
    expect(res.kind).toBe("rate_limited");
    expect(res.status).toBe(429);
    if (res.kind === "rate_limited") {
      expect(res.retryAfter).toBe(45);
    }
  });

  it("decides 200 password prompt for password-protected link", () => {
    const res = decideRedirect({
      code: "pw-link",
      link: { ...activeLink, password_hash: "pbkdf2$hash" },
    });
    expect(res.kind).toBe("password");
    expect(res.status).toBe(200);
  });

  it("decides 200 password_pending_review without disclosing destination URL", () => {
    const res = decideRedirect({
      code: "flagged-pw",
      link: {
        ...activeLink,
        status: "pending_review",
        password_hash: "pbkdf2$hash",
      },
    });
    expect(res.kind).toBe("password_pending_review");
    expect(res.status).toBe(200);
    // @ts-expect-error verifying no url on password_pending_review
    expect(res.url).toBeUndefined();
  });

  it("decides 200 pending_review with destination URL for unprotected flagged link", () => {
    const res = decideRedirect({
      code: "flagged-unprotected",
      link: { ...activeLink, status: "pending_review" },
    });
    expect(res.kind).toBe("pending_review");
    expect(res.status).toBe(200);
    if (res.kind === "pending_review") {
      expect(res.url).toBe("https://example.com/target");
    }
  });
});

describe("redirect-decision: validatePostOrigin (Amendment A5)", () => {
  it("allows matching request host and public site url", () => {
    const req1 = new Request("https://marvedge.com/go/abc", {
      headers: {
        host: "marvedge.com",
        origin: "https://marvedge.com",
      },
    });
    expect(validatePostOrigin(req1, "https://marvedge.com")).toBe(true);

    const req2 = new Request("https://marvedge.com/go/abc", {
      headers: {
        host: "localhost:3000",
        origin: "https://marvedge.com",
      },
    });
    expect(validatePostOrigin(req2, "https://marvedge.com")).toBe(true);
  });

  it("rejects cross-origin requests", () => {
    const req = new Request("https://marvedge.com/go/abc", {
      headers: {
        host: "marvedge.com",
        origin: "https://evil-attacker.com",
      },
    });
    expect(validatePostOrigin(req, "https://marvedge.com")).toBe(false);
  });

  it("falls back to sec-fetch-site header", () => {
    const reqSame = new Request("https://marvedge.com/go/abc", {
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(validatePostOrigin(reqSame)).toBe(true);

    const reqCross = new Request("https://marvedge.com/go/abc", {
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(validatePostOrigin(reqCross)).toBe(false);
  });

  it("rejects when no origin or sec-fetch-site is provided", () => {
    const req = new Request("https://marvedge.com/go/abc");
    expect(validatePostOrigin(req)).toBe(false);
  });
});

describe("handleGoPostService (Native POST handler on /go/:code)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMockDb = (initialLinks: Record<string, any> = {}) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const links = new Map<string, any>(Object.entries(initialLinks));
    const clicks: string[] = [];

    const db = {
      clicks,
      from: (table: string) => {
        if (table === "short_links") {
          let filterCode: string | null = null;
          const query = {
            select: () => query,
            eq: (_col: string, val: string) => {
              filterCode = val;
              return query;
            },
            maybeSingle: async () => {
              if (!filterCode || !links.has(filterCode)) {
                return { data: null, error: null };
              }
              return { data: { ...links.get(filterCode) }, error: null };
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            update: (patch: any) => ({
              eq: async (_col: string, val: string) => {
                if (links.has(val)) {
                  links.set(val, { ...links.get(val), ...patch });
                }
                return { error: null };
              },
            }),
          };
          return query;
        }
        if (table === "blocked_domains") {
          return {
            select: () => ({
              data: [{ domain: "malware.com" }],
              error: null,
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
      rpc: async (fn: string, args: { p_code: string }) => {
        if (fn === "register_click") {
          clicks.push(args.p_code);
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
    };
    return db;
  };

  it("rejects cross-origin POST with 403", async () => {
    const body = new FormData();
    body.set("action", "continue");
    const req = new Request("https://marvedge.com/go/test-link", {
      method: "POST",
      headers: {
        host: "marvedge.com",
        origin: "https://attacker.com",
      },
      body,
    });
    const db = createMockDb();
    const res = await handleGoPostService(req, "test-link", { db, req });
    expect(res.status).toBe(403);
  });

  it("handles action=continue for interstitial link, awaits click, and returns 302", async () => {
    const db = createMockDb({
      "pending-1": {
        code: "pending-1",
        url: "https://example.com/target",
        target_host: "example.com",
        status: "pending_review",
        expires_at: null,
        password_hash: null,
      },
    });

    const body = new FormData();
    body.set("action", "continue");
    const req = new Request("https://marvedge.com/go/pending-1", {
      method: "POST",
      headers: {
        host: "marvedge.com",
        origin: "https://marvedge.com",
      },
      body,
    });

    const res = await handleGoPostService(req, "pending-1", { db, req });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://example.com/target");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(db.clicks).toEqual(["pending-1"]);
  });

  it("handles action=unlock with correct password and returns 302", async () => {
    const pwHash = await hashPassword("super-secret");
    const db = createMockDb({
      "pw-link": {
        code: "pw-link",
        url: "https://example.com/secret-doc",
        target_host: "example.com",
        status: "active",
        expires_at: null,
        password_hash: pwHash,
      },
    });

    const body = new FormData();
    body.set("action", "unlock");
    body.set("password", "super-secret");
    const req = new Request("https://marvedge.com/go/pw-link", {
      method: "POST",
      headers: {
        host: "marvedge.com",
        origin: "https://marvedge.com",
      },
      body,
    });

    const res = await handleGoPostService(req, "pw-link", {
      db,
      req,
      rateLimitFn: async () => ({
        allowed: true,
        remaining: 5,
        retryAfter: 0,
      }),
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://example.com/secret-doc");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("handles action=unlock with wrong password and returns 401", async () => {
    const pwHash = await hashPassword("super-secret");
    const db = createMockDb({
      "pw-link": {
        code: "pw-link",
        url: "https://example.com/secret-doc",
        target_host: "example.com",
        status: "active",
        expires_at: null,
        password_hash: pwHash,
      },
    });

    const body = new FormData();
    body.set("action", "unlock");
    body.set("password", "wrong-password");
    const req = new Request("https://marvedge.com/go/pw-link", {
      method: "POST",
      headers: {
        host: "marvedge.com",
        origin: "https://marvedge.com",
      },
      body,
    });

    const res = await handleGoPostService(req, "pw-link", {
      db,
      req,
      rateLimitFn: async () => ({
        allowed: true,
        remaining: 5,
        retryAfter: 0,
      }),
    });

    expect(res.status).toBe(401);
  });

  it("handles action=continue on expired link and returns 410", async () => {
    const db = createMockDb({
      "exp-link": {
        code: "exp-link",
        url: "https://example.com/target",
        target_host: "example.com",
        status: "active",
        expires_at: new Date(Date.now() - 60000).toISOString(),
        password_hash: null,
      },
    });

    const body = new FormData();
    body.set("action", "continue");
    const req = new Request("https://marvedge.com/go/exp-link", {
      method: "POST",
      headers: {
        host: "marvedge.com",
        origin: "https://marvedge.com",
      },
      body,
    });

    const res = await handleGoPostService(req, "exp-link", { db, req });
    expect(res.status).toBe(410);
    expect(db.clicks).toHaveLength(0);
  });
});
