import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireAdminAuth } from "@/lib/links/admin-auth.server";
import {
  listReportsService,
  updateReportService,
  updateLinkStatusService,
  addBlockedDomainService,
  removeBlockedDomainService,
  listBlockedDomainsService,
} from "@/lib/links/admin.server";

describe("admin-auth: requireAdminAuth", () => {
  const TEST_KEY = "test-admin-secret-key-1234567890";

  it("returns 500 when ADMIN_API_KEY is unset or empty", async () => {
    const req = new Request("http://localhost/api/admin/links/reports", {
      headers: { "x-admin-api-key": "any-key" },
    });

    // Unset key
    const res1 = await requireAdminAuth(req, { adminApiKey: "" });
    expect(res1.ok).toBe(false);
    if (!res1.ok) {
      expect(res1.response.status).toBe(500);
      const json = await res1.response.json();
      expect(json.error.code).toBe("server_misconfigured");
    }

    // Whitespace key
    const res2 = await requireAdminAuth(req, { adminApiKey: "   " });
    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.response.status).toBe(500);
    }
  });

  it("returns 401 when x-admin-api-key header is missing or empty", async () => {
    const req1 = new Request("http://localhost/api/admin/links/reports");
    const res1 = await requireAdminAuth(req1, {
      adminApiKey: TEST_KEY,
      rateLimitFn: async () => ({ allowed: true, remaining: 10, retryAfter: 0 }),
    });
    expect(res1.ok).toBe(false);
    if (!res1.ok) {
      expect(res1.response.status).toBe(401);
      const json = await res1.response.json();
      expect(json.error.code).toBe("unauthorized");
    }

    const req2 = new Request("http://localhost/api/admin/links/reports", {
      headers: { "x-admin-api-key": "   " },
    });
    const res2 = await requireAdminAuth(req2, {
      adminApiKey: TEST_KEY,
      rateLimitFn: async () => ({ allowed: true, remaining: 10, retryAfter: 0 }),
    });
    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.response.status).toBe(401);
    }
  });

  it("returns 401 when key is incorrect or length-mismatched", async () => {
    // Shorter key
    const reqShort = new Request("http://localhost/api/admin/links/reports", {
      headers: { "x-admin-api-key": "short" },
    });
    const resShort = await requireAdminAuth(reqShort, {
      adminApiKey: TEST_KEY,
      rateLimitFn: async () => ({ allowed: true, remaining: 10, retryAfter: 0 }),
    });
    expect(resShort.ok).toBe(false);
    if (!resShort.ok) {
      expect(resShort.response.status).toBe(401);
    }

    // Longer key
    const reqLong = new Request("http://localhost/api/admin/links/reports", {
      headers: { "x-admin-api-key": TEST_KEY + "-extra-long-characters" },
    });
    const resLong = await requireAdminAuth(reqLong, {
      adminApiKey: TEST_KEY,
      rateLimitFn: async () => ({ allowed: true, remaining: 10, retryAfter: 0 }),
    });
    expect(resLong.ok).toBe(false);
    if (!resLong.ok) {
      expect(resLong.response.status).toBe(401);
    }
  });

  it("rate limits repeated failed authentication attempts", async () => {
    const req = new Request("http://localhost/api/admin/links/reports", {
      headers: { "x-admin-api-key": "wrong" },
    });

    const res = await requireAdminAuth(req, {
      adminApiKey: TEST_KEY,
      rateLimitFn: async () => ({ allowed: false, remaining: 0, retryAfter: 600 }),
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.response.status).toBe(429);
      expect(res.response.headers.get("Retry-After")).toBe("600");
      const json = await res.response.json();
      expect(json.error.code).toBe("rate_limited");
    }
  });

  it("succeeds when key matches exactly", async () => {
    const req = new Request("http://localhost/api/admin/links/reports", {
      headers: { "x-admin-api-key": TEST_KEY },
    });

    const res = await requireAdminAuth(req, {
      adminApiKey: TEST_KEY,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.ipHash).toBeDefined();
    }
  });
});

describe("admin service: reports moderation", () => {
  const TEST_KEY = "valid-admin-secret-key";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMockDb = (initialReports: any[] = []) => {
    const reports = [...initialReports];
    const db = {
      _reports: reports,
      from: (table: string) => {
        if (table === "link_reports") {
          let statusFilter: string | null = null;
          let rangeStart = 0;
          let rangeEnd = 100;
          let updatePatch: Record<string, unknown> | null = null;

          const query = {
            select: () => query,
            order: () => query,
            range: (from: number, to: number) => {
              rangeStart = from;
              rangeEnd = to;
              return query;
            },
            eq: (col: string, val: string) => {
              if (col === "status") statusFilter = val;
              if (col === "id" && updatePatch) {
                const item = reports.find((r) => r.id === val);
                if (item) Object.assign(item, updatePatch);
              }
              return query;
            },
            update: (patch: Record<string, unknown>) => {
              updatePatch = patch;
              return query;
            },
            then: (resolve: (res: { data: unknown[]; count: number; error: null }) => void) => {
              let filtered = reports;
              if (statusFilter) {
                filtered = filtered.filter((r) => r.status === statusFilter);
              }
              const slice = filtered.slice(rangeStart, rangeEnd + 1);
              resolve({ data: slice, count: filtered.length, error: null });
            },
          };
          return query;
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };
    return db;
  };

  it("lists reports with pagination and status filtering", async () => {
    const mockReports = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        code: "link-1",
        status: "open",
        reason: "spam",
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        code: "link-2",
        status: "reviewed",
        reason: "phishing",
      },
      {
        id: "33333333-3333-3333-3333-333333333333",
        code: "link-3",
        status: "open",
        reason: "malware",
      },
    ];
    const db = createMockDb(mockReports);

    // Filter status=open
    const req = new Request(
      "http://localhost/api/admin/links/reports?status=open&limit=10&offset=0",
      {
        headers: { "x-admin-api-key": TEST_KEY },
      },
    );

    const res = await listReportsService(req, { db, adminApiKey: TEST_KEY });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.count).toBe(2);
    expect(json.limit).toBe(10);
    expect(json.offset).toBe(0);
  });

  it("clamps limit to maximum 100", async () => {
    const db = createMockDb([]);
    const req = new Request("http://localhost/api/admin/links/reports?limit=9999", {
      headers: { "x-admin-api-key": TEST_KEY },
    });

    const res = await listReportsService(req, { db, adminApiKey: TEST_KEY });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.limit).toBe(100);
  });

  it("updates report status and logs admin_action", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const mockReports = [
      { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", code: "link-1", status: "open" },
    ];
    const db = createMockDb(mockReports);

    const req = new Request("http://localhost/api/admin/links/reports", {
      method: "PATCH",
      headers: {
        "x-admin-api-key": TEST_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reportId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        status: "actioned",
      }),
    });

    const res = await updateReportService(req, { db, adminApiKey: TEST_KEY });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(db._reports[0]?.status).toBe("actioned");

    expect(infoSpy).toHaveBeenCalled();
    const logged = JSON.parse(infoSpy.mock.calls[0]?.[0] as string);
    expect(logged.event).toBe("admin_action");
    expect(logged.action).toBe("update_report");
    expect(logged.report_id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(logged.new_status).toBe("actioned");
    infoSpy.mockRestore();
  });

  it("rejects invalid report update payload", async () => {
    const db = createMockDb([]);
    const req = new Request("http://localhost/api/admin/links/reports", {
      method: "PATCH",
      headers: {
        "x-admin-api-key": TEST_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reportId: "not-a-uuid",
        status: "invalid-status",
      }),
    });

    const res = await updateReportService(req, { db, adminApiKey: TEST_KEY });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("validation_error");
  });
});

describe("admin service: link status moderation & restore", () => {
  const TEST_KEY = "valid-admin-secret-key";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMockDb = (linksMap: Record<string, any> = {}) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const links = new Map<string, any>(Object.entries(linksMap));
    const blockedDomains: string[] = [];
    const restoredCodes: string[] = [];

    const db = {
      _links: links,
      _blockedDomains: blockedDomains,
      _restoredCodes: restoredCodes,
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
              if (!filterCode || !links.has(filterCode)) return { data: null, error: null };
              return { data: { ...links.get(filterCode) }, error: null };
            },
            update: (patch: Record<string, unknown>) => ({
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
            insert: async (row: { domain: string; source: string }) => {
              blockedDomains.push(row.domain);
              return { error: null };
            },
          };
        }
        if (table === "link_reports") {
          return {
            update: () => ({
              eq: () => ({
                eq: async () => ({ error: null }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
      rpc: async (fn: string, args: { p_code: string }) => {
        if (fn === "admin_restore_link") {
          restoredCodes.push(args.p_code);
          if (links.has(args.p_code)) {
            links.set(args.p_code, { ...links.get(args.p_code), status: "active" });
          }
          return { data: null, error: null };
        }
        return { data: null, error: null };
      },
    };
    return db;
  };

  it("updates link status to disabled and logs admin_action", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const db = createMockDb({
      "test-1": {
        code: "test-1",
        status: "active",
        url: "https://example.com",
        target_host: "example.com",
      },
    });

    const req = new Request("http://localhost/api/admin/links/status", {
      method: "POST",
      headers: {
        "x-admin-api-key": TEST_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: "test-1", status: "disabled" }),
    });

    const res = await updateLinkStatusService(req, { db, adminApiKey: TEST_KEY });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("disabled");
    expect(db._links.get("test-1")?.status).toBe("disabled");

    expect(infoSpy).toHaveBeenCalled();
    const logged = JSON.parse(infoSpy.mock.calls[0]?.[0] as string);
    expect(logged).toEqual({
      event: "admin_action",
      code: "test-1",
      action: "update_status",
      new_status: "disabled",
    });
    infoSpy.mockRestore();
  });

  it("runs admin_restore_link RPC when restoring pending_review link to active", async () => {
    const db = createMockDb({
      "flagged-1": {
        code: "flagged-1",
        status: "pending_review",
        url: "https://example.com",
        target_host: "example.com",
      },
    });

    const req = new Request("http://localhost/api/admin/links/status", {
      method: "POST",
      headers: {
        "x-admin-api-key": TEST_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: "flagged-1", status: "active" }),
    });

    const res = await updateLinkStatusService(req, { db, adminApiKey: TEST_KEY });
    expect(res.status).toBe(200);
    expect(db._restoredCodes).toContain("flagged-1");
    expect(db._links.get("flagged-1")?.status).toBe("active");
  });

  it("adds target domain to blocked_domains when status is blocked and addDomain is true", async () => {
    const db = createMockDb({
      "bad-link": {
        code: "bad-link",
        status: "active",
        url: "https://malware.org/download",
        target_host: "malware.org",
      },
    });

    const req = new Request("http://localhost/api/admin/links/status", {
      method: "POST",
      headers: {
        "x-admin-api-key": TEST_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: "bad-link",
        status: "blocked",
        addDomain: true,
      }),
    });

    const res = await updateLinkStatusService(req, { db, adminApiKey: TEST_KEY });
    expect(res.status).toBe(200);
    expect(db._links.get("bad-link")?.status).toBe("blocked");
    expect(db._blockedDomains).toContain("malware.org");
  });

  it("returns 404 when link does not exist", async () => {
    const db = createMockDb({});
    const req = new Request("http://localhost/api/admin/links/status", {
      method: "POST",
      headers: {
        "x-admin-api-key": TEST_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: "non-existent", status: "blocked" }),
    });

    const res = await updateLinkStatusService(req, { db, adminApiKey: TEST_KEY });
    expect(res.status).toBe(404);
  });
});

describe("admin service: blocked domains management", () => {
  const TEST_KEY = "valid-admin-secret-key";

  const createMockDb = (initialDomains: { domain: string; source: string }[] = []) => {
    const domains = [...initialDomains];
    const db = {
      _domains: domains,
      from: (table: string) => {
        if (table === "blocked_domains") {
          const query = {
            select: () => query,
            order: () => query,
            insert: async (row: { domain: string; source: string }) => {
              if (domains.some((d) => d.domain === row.domain)) {
                return { error: { code: "23505" } };
              }
              domains.push(row);
              return { error: null };
            },
            delete: () => ({
              eq: async (_col: string, val: string) => {
                const idx = domains.findIndex((d) => d.domain === val);
                if (idx !== -1) domains.splice(idx, 1);
                return { error: null };
              },
            }),
            then: (resolve: (res: { data: unknown[]; error: null }) => void) => {
              resolve({ data: domains, error: null });
            },
          };
          return query;
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };
    return db;
  };

  it("adds and normalizes a blocked domain", async () => {
    const db = createMockDb();
    const req = new Request("http://localhost/api/admin/links/blocked-domains", {
      method: "POST",
      headers: {
        "x-admin-api-key": TEST_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        domain: "https://Spam-Site.Com/path?query=1",
        source: "admin_investigation",
      }),
    });

    const res = await addBlockedDomainService(req, { db, adminApiKey: TEST_KEY });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.domain).toBe("spam-site.com");
    expect(json.source).toBe("admin_investigation");
    expect(db._domains[0]?.domain).toBe("spam-site.com");
  });

  it("removes a blocked domain via query param or json body", async () => {
    const db = createMockDb([{ domain: "badsite.com", source: "admin" }]);

    const req = new Request("http://localhost/api/admin/links/blocked-domains?domain=badsite.com", {
      method: "DELETE",
      headers: { "x-admin-api-key": TEST_KEY },
    });

    const res = await removeBlockedDomainService(req, { db, adminApiKey: TEST_KEY });
    expect(res.status).toBe(200);
    expect(db._domains).toHaveLength(0);
  });

  it("lists all blocked domains", async () => {
    const db = createMockDb([
      { domain: "a.com", source: "admin" },
      { domain: "b.com", source: "feed" },
    ]);

    const req = new Request("http://localhost/api/admin/links/blocked-domains", {
      headers: { "x-admin-api-key": TEST_KEY },
    });

    const res = await listBlockedDomainsService(req, { db, adminApiKey: TEST_KEY });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
  });
});

describe("admin routes: server handlers wiring", () => {
  it("wires reports route handlers", async () => {
    const { Route } = await import("@/routes/api.admin.links.reports");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = Route.options.server?.handlers as any;
    expect(handlers?.GET).toBeDefined();
    expect(handlers?.PATCH).toBeDefined();

    const req = new Request("http://localhost/api/admin/links/reports");
    const getRes = await handlers.GET({ request: req });
    expect(getRes.status).toBe(500); // Unset env key
  });

  it("wires status route handlers", async () => {
    const { Route } = await import("@/routes/api.admin.links.status");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = Route.options.server?.handlers as any;
    expect(handlers?.POST).toBeDefined();

    const req = new Request("http://localhost/api/admin/links/status", { method: "POST" });
    const postRes = await handlers.POST({ request: req });
    expect(postRes.status).toBe(500); // Unset env key
  });

  it("wires blocked-domains route handlers", async () => {
    const { Route } = await import("@/routes/api.admin.links.blocked-domains");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers = Route.options.server?.handlers as any;
    expect(handlers?.GET).toBeDefined();
    expect(handlers?.POST).toBeDefined();
    expect(handlers?.DELETE).toBeDefined();

    const req = new Request("http://localhost/api/admin/links/blocked-domains");
    const getRes = await handlers.GET({ request: req });
    expect(getRes.status).toBe(500); // Unset env key
  });
});
