/**
 * Administrative moderation service logic for short links.
 * DESIGN.md §7.2
 */

import { z } from "zod";
import { jsonResponse, requireAdminAuth, type AdminAuthDeps } from "./admin-auth.server";

export interface AdminServiceDeps extends AdminAuthDeps {
  now?: () => Date;
}

async function getAdminDb(deps?: AdminServiceDeps) {
  if (deps?.db) return deps.db;
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

// ---------------------------------------------------------------------------
// 1. Reports Management
// ---------------------------------------------------------------------------

const patchReportSchema = z.object({
  reportId: z.string().uuid("Invalid reportId format"),
  status: z.enum(["reviewed", "actioned", "dismissed"]),
});

export async function listReportsService(req: Request, deps?: AdminServiceDeps): Promise<Response> {
  const auth = await requireAdminAuth(req, deps);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");

  const validStatuses = ["open", "reviewed", "actioned", "dismissed"] as const;
  type ReportStatus = (typeof validStatuses)[number];
  let statusFilter: ReportStatus | undefined;
  if (statusParam && validStatuses.includes(statusParam as ReportStatus)) {
    statusFilter = statusParam as ReportStatus;
  }

  const rawLimit = parseInt(limitParam || "50", 10);
  const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 100);

  const rawOffset = parseInt(offsetParam || "0", 10);
  const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

  const db = await getAdminDb(deps);

  let query = db
    .from("link_reports")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, count, error } = await query;
  if (error) {
    return jsonResponse(
      { error: { code: "database_error", message: "Failed to query reports" } },
      500,
    );
  }

  return jsonResponse({
    data: data ?? [],
    count: count ?? (data ? data.length : 0),
    limit,
    offset,
  });
}

export async function updateReportService(
  req: Request,
  deps?: AdminServiceDeps,
): Promise<Response> {
  const auth = await requireAdminAuth(req, deps);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: { code: "invalid_json", message: "Invalid JSON request body" } },
      400,
    );
  }

  const parsed = patchReportSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid payload",
        },
      },
      400,
    );
  }

  const { reportId, status } = parsed.data;
  const db = await getAdminDb(deps);

  const { error } = await db
    .from("link_reports")
    .update({
      status,
    })
    .eq("id", reportId);

  if (error) {
    return jsonResponse(
      { error: { code: "database_error", message: "Failed to update report status" } },
      500,
    );
  }

  // Structured audit log
  console.info(
    JSON.stringify({
      event: "admin_action",
      action: "update_report",
      report_id: reportId,
      new_status: status,
    }),
  );

  return jsonResponse({ ok: true, reportId, status });
}

// ---------------------------------------------------------------------------
// 2. Link Status Moderation
// ---------------------------------------------------------------------------

const updateLinkStatusSchema = z.object({
  code: z.string().min(1, "Link code is required").max(100),
  status: z.enum(["active", "disabled", "blocked", "pending_review"]),
  addDomain: z.boolean().optional(),
});

export async function updateLinkStatusService(
  req: Request,
  deps?: AdminServiceDeps,
): Promise<Response> {
  const auth = await requireAdminAuth(req, deps);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: { code: "invalid_json", message: "Invalid JSON request body" } },
      400,
    );
  }

  const parsed = updateLinkStatusSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid payload",
        },
      },
      400,
    );
  }

  const { code, status: newStatus, addDomain } = parsed.data;
  const db = await getAdminDb(deps);
  const now = deps?.now ? deps.now() : new Date();

  // 1. Fetch short link row
  const { data: row } = await db.from("short_links").select("*").eq("code", code).maybeSingle();

  if (!row) {
    return jsonResponse({ error: { code: "not_found", message: "Short link not found" } }, 404);
  }

  // 2. Restore flow: active from pending_review or blocked
  if (newStatus === "active" && (row.status === "pending_review" || row.status === "blocked")) {
    try {
      await db.rpc("admin_restore_link", { p_code: code });
    } catch {
      // Fallback update if RPC is missing
      await db
        .from("short_links")
        .update({ status: "active", updated_at: now.toISOString() })
        .eq("code", code);
      await db
        .from("link_reports")
        .update({ status: "reviewed" })
        .eq("code", code)
        .eq("status", "open");
    }
  } else {
    // Normal status transition
    const { error: updateErr } = await db
      .from("short_links")
      .update({ status: newStatus, updated_at: now.toISOString() })
      .eq("code", code);

    if (updateErr) {
      return jsonResponse(
        { error: { code: "database_error", message: "Failed to update link status" } },
        500,
      );
    }
  }

  // 3. Blocked + addDomain: inserts target_host into blocked_domains with source 'admin'
  if (newStatus === "blocked" && addDomain && row.target_host) {
    try {
      await db.from("blocked_domains").insert({
        domain: row.target_host.toLowerCase().trim(),
        source: "admin",
      });
    } catch {
      // Ignore conflict / duplicate
    }
  }

  // 4. Structured audit log (code, action, new_status only)
  console.info(
    JSON.stringify({
      event: "admin_action",
      code,
      action: "update_status",
      new_status: newStatus,
    }),
  );

  return jsonResponse({ ok: true, code, status: newStatus });
}

// ---------------------------------------------------------------------------
// 3. Blocked Domains Management
// ---------------------------------------------------------------------------

function normalizeDomain(input: string): string {
  let cleaned = input.trim().toLowerCase();
  // Strip http:// or https:// if provided
  if (cleaned.startsWith("http://")) cleaned = cleaned.substring(7);
  if (cleaned.startsWith("https://")) cleaned = cleaned.substring(8);
  // Strip path or trailing slash if provided
  const slashIdx = cleaned.indexOf("/");
  if (slashIdx !== -1) cleaned = cleaned.substring(0, slashIdx);
  // Strip port if provided
  const portIdx = cleaned.indexOf(":");
  if (portIdx !== -1) cleaned = cleaned.substring(0, portIdx);
  return cleaned;
}

const addBlockedDomainSchema = z.object({
  domain: z.string().min(1, "Domain is required").max(255),
  source: z.string().max(100).optional(),
});

export async function addBlockedDomainService(
  req: Request,
  deps?: AdminServiceDeps,
): Promise<Response> {
  const auth = await requireAdminAuth(req, deps);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { error: { code: "invalid_json", message: "Invalid JSON request body" } },
      400,
    );
  }

  const parsed = addBlockedDomainSchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      {
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid payload",
        },
      },
      400,
    );
  }

  const normalized = normalizeDomain(parsed.data.domain);
  if (
    !normalized ||
    normalized.includes(" ") ||
    normalized.includes("/") ||
    normalized.length < 3
  ) {
    return jsonResponse(
      { error: { code: "invalid_domain", message: "Invalid domain format" } },
      400,
    );
  }

  const db = await getAdminDb(deps);
  const source = parsed.data.source?.trim() || "admin";

  const { error } = await db.from("blocked_domains").insert({
    domain: normalized,
    source,
  });

  if (error && error.code !== "23505") {
    return jsonResponse(
      { error: { code: "database_error", message: "Failed to add blocked domain" } },
      500,
    );
  }

  console.info(
    JSON.stringify({
      event: "admin_action",
      action: "add_blocked_domain",
      domain: normalized,
    }),
  );

  return jsonResponse({ ok: true, domain: normalized, source });
}

export async function removeBlockedDomainService(
  req: Request,
  deps?: AdminServiceDeps,
): Promise<Response> {
  const auth = await requireAdminAuth(req, deps);
  if (!auth.ok) return auth.response;

  let domain: string | null = null;
  const url = new URL(req.url);
  const qDomain = url.searchParams.get("domain");

  if (qDomain) {
    domain = qDomain;
  } else {
    try {
      const body = (await req.json()) as { domain?: string };
      domain = body.domain ?? null;
    } catch {
      // Body empty or invalid JSON
    }
  }

  if (!domain || typeof domain !== "string" || domain.trim().length === 0) {
    return jsonResponse(
      { error: { code: "validation_error", message: "Domain is required" } },
      400,
    );
  }

  const normalized = normalizeDomain(domain);
  const db = await getAdminDb(deps);

  const { error } = await db.from("blocked_domains").delete().eq("domain", normalized);

  if (error) {
    return jsonResponse(
      { error: { code: "database_error", message: "Failed to remove blocked domain" } },
      500,
    );
  }

  console.info(
    JSON.stringify({
      event: "admin_action",
      action: "remove_blocked_domain",
      domain: normalized,
    }),
  );

  return jsonResponse({ ok: true, domain: normalized });
}

export async function listBlockedDomainsService(
  req: Request,
  deps?: AdminServiceDeps,
): Promise<Response> {
  const auth = await requireAdminAuth(req, deps);
  if (!auth.ok) return auth.response;

  const db = await getAdminDb(deps);
  const { data, error } = await db
    .from("blocked_domains")
    .select("*")
    .order("added_at", { ascending: false });

  if (error) {
    return jsonResponse(
      { error: { code: "database_error", message: "Failed to list blocked domains" } },
      500,
    );
  }

  return jsonResponse({ data: data ?? [] });
}
