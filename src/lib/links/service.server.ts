/**
 * Core business and database service logic for short links.
 * DESIGN.md §7.1 & openapi.yaml
 */

import { validateTargetUrl } from "./url-policy";
import { isReservedSlug, validateSlugFormat } from "./reserved";
import { generateUniqueSlug } from "./slug";
import { hashPassword, verifyPassword } from "./password";
import { generateCreatorToken, verifyCreatorToken } from "./token";
import { isBlockedHost, noopReputationProvider, type UrlReputationProvider } from "./blocklist";
import { LIMITS, rateLimit, type RateLimitResult } from "./ratelimit.server";
import { getClientIp, hashIp, getReporterIdentity, type ReporterIdentity } from "./ip.server";

export interface ServiceDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any;
  req?: Request;
  now?: () => Date;
  rateLimitFn?: (
    key: string,
    windowSeconds: number,
    limit: number,
    opts?: { failClosed?: boolean; db?: unknown },
  ) => Promise<RateLimitResult>;
  reputationProvider?: UrlReputationProvider;
  getIdentityFn?: (req: Request) => ReporterIdentity;
}

async function getAdminDb(deps?: ServiceDeps) {
  if (deps?.db) return deps.db;
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function resolveRequest(deps?: ServiceDeps): Promise<Request | undefined> {
  if (deps?.req) return deps.req;
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    return getRequest();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 1. createShortLink
// ---------------------------------------------------------------------------

export interface CreateShortLinkInput {
  url: string;
  code?: string;
  password?: string;
  expiresAt?: string;
}

export type CreateShortLinkResult =
  | { ok: true; code: string; creatorToken: string }
  | {
      ok: false;
      error:
        "taken" | "reserved" | "invalid_url" | "blocked_domain" | "rate_limited" | "server_error";
      retryAfter?: number;
    };

export async function createShortLinkService(
  input: CreateShortLinkInput,
  deps?: ServiceDeps,
): Promise<CreateShortLinkResult> {
  const db = await getAdminDb(deps);
  const req = await resolveRequest(deps);
  const now = deps?.now ? deps.now() : new Date();
  const rl = deps?.rateLimitFn ?? rateLimit;
  const reputation = deps?.reputationProvider ?? noopReputationProvider;

  // 1. IP identification & rate limiting
  const ip = req ? getClientIp(req) : null;
  const ipHash = ip ? hashIp(ip) : "anonymous";

  const rlHour = await rl(
    `create_hour:${ipHash}`,
    LIMITS.createHour.windowSeconds,
    LIMITS.createHour.limit,
    { failClosed: true, db },
  );
  if (!rlHour.allowed) {
    return { ok: false, error: "rate_limited", retryAfter: rlHour.retryAfter };
  }

  const rlMin = await rl(
    `create_min:${ipHash}`,
    LIMITS.createMinute.windowSeconds,
    LIMITS.createMinute.limit,
    { failClosed: true, db },
  );
  if (!rlMin.allowed) {
    return { ok: false, error: "rate_limited", retryAfter: rlMin.retryAfter };
  }

  // 2. Validate URL policy
  let siteHost: string | undefined;
  try {
    const publicUrl = process.env["PUBLIC_SITE_URL"];
    if (publicUrl) {
      siteHost = new URL(publicUrl).host;
    }
  } catch {
    siteHost = "marvedge.com";
  }

  const valRes = validateTargetUrl(input.url, {
    siteHost: siteHost ?? "marvedge.com",
    blockShortenerChains: process.env["BLOCK_SHORTENER_CHAINS"] === "true",
  });

  if (!valRes.ok) {
    return { ok: false, error: "invalid_url" };
  }

  // 3. Blocklist check
  try {
    const { data: blockedRows } = await db.from("blocked_domains").select("domain");
    const blockedList = (blockedRows ?? []).map((r: { domain: string }) => r.domain);
    if (isBlockedHost(valRes.host, blockedList)) {
      return { ok: false, error: "blocked_domain" };
    }
  } catch {
    // If blocklist lookup fails, proceed safely
  }

  const repRes = await reputation.check(valRes.url);
  if (!repRes.safe) {
    return { ok: false, error: "blocked_domain" };
  }

  // 4. Slug resolution
  let finalCode: string;
  if (input.code) {
    if (!validateSlugFormat(input.code)) {
      return { ok: false, error: "invalid_url" };
    }
    if (isReservedSlug(input.code)) {
      return { ok: false, error: "reserved" };
    }
    finalCode = input.code;
  } else {
    try {
      finalCode = await generateUniqueSlug(async (candidate) => {
        const { data } = await db
          .from("short_links")
          .select("code")
          .eq("code", candidate)
          .maybeSingle();
        return Boolean(data);
      });
    } catch {
      return { ok: false, error: "server_error" };
    }
  }

  // 5. Password & Expiry
  let pwHash: string | null = null;
  if (input.password) {
    pwHash = await hashPassword(input.password);
  }

  let expiresAtIso: string | null = null;
  if (input.expiresAt) {
    const expDate = new Date(input.expiresAt);
    if (isNaN(expDate.getTime()) || expDate <= now) {
      return { ok: false, error: "invalid_url" };
    }
    expiresAtIso = expDate.toISOString();
  }

  // 6. Creator token & status
  const { token: creatorToken, hash: creatorTokenHash } = generateCreatorToken();
  const status = valRes.flagPendingReview ? "pending_review" : "active";

  // 7. Insert row
  const { error } = await db.from("short_links").insert({
    code: finalCode,
    url: valRes.url,
    password_hash: pwHash,
    expires_at: expiresAtIso,
    target_host: valRes.host,
    creator_token_hash: creatorTokenHash,
    status,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "taken" };
    }
    return { ok: false, error: "server_error" };
  }

  // 8. Structured audit log
  console.info(
    JSON.stringify({
      event: "link_created",
      code: finalCode,
      target_host: valRes.host,
      has_password: Boolean(input.password),
      has_expiry: Boolean(expiresAtIso),
      status,
    }),
  );

  return { ok: true, code: finalCode, creatorToken };
}

// ---------------------------------------------------------------------------
// 2. resolveShortLink
// ---------------------------------------------------------------------------

export interface ResolveShortLinkInput {
  code: string;
  password?: string;
}

export type ResolveShortLinkResult =
  | { status: "ok"; url: string }
  | { status: "password" }
  | { status: "password_pending_review" }
  | { status: "expired" }
  | { status: "missing" }
  | { status: "wrong" }
  | { status: "disabled" }
  | { status: "blocked" }
  | { status: "pending_review"; url: string }
  | { status: "rate_limited"; retryAfter: number };

export async function resolveShortLinkService(
  input: ResolveShortLinkInput,
  deps?: ServiceDeps,
): Promise<ResolveShortLinkResult> {
  const db = await getAdminDb(deps);
  const req = await resolveRequest(deps);
  const now = deps?.now ? deps.now() : new Date();
  const rl = deps?.rateLimitFn ?? rateLimit;

  // 1. IP identification & resolution rate limit (fail-open)
  const ip = req ? getClientIp(req) : null;
  const ipHash = ip ? hashIp(ip) : "anonymous";

  const rlRes = await rl(`resolve:${ipHash}`, LIMITS.resolve.windowSeconds, LIMITS.resolve.limit, {
    failClosed: false,
    db,
  });
  if (!rlRes.allowed) {
    return { status: "rate_limited", retryAfter: rlRes.retryAfter };
  }

  // 2. Fetch short link row
  const { data: row } = await db
    .from("short_links")
    .select("*")
    .eq("code", input.code)
    .maybeSingle();

  if (!row) {
    return { status: "missing" };
  }

  // 3. Status checks
  if (row.status === "blocked") {
    return { status: "blocked" };
  }
  if (row.status === "disabled") {
    return { status: "disabled" };
  }

  // 4. Dynamic expiry check
  if (row.expires_at && new Date(row.expires_at) <= now) {
    return { status: "expired" };
  }

  // 5. Dynamic domain blocklist re-check (FR-11)
  if (row.target_host) {
    try {
      const { data: blockedRows } = await db.from("blocked_domains").select("domain");
      const blockedList = (blockedRows ?? []).map((r: { domain: string }) => r.domain);
      if (isBlockedHost(row.target_host, blockedList)) {
        await db.from("short_links").update({ status: "blocked" }).eq("code", input.code);
        return { status: "blocked" };
      }
    } catch {
      // Proceed on DB error
    }
  }

  // 6. Password handling
  if (row.password_hash) {
    if (!input.password) {
      if (row.status === "pending_review") {
        return { status: "password_pending_review" };
      }
      return { status: "password" };
    }

    // Rate-limit password attempt (fail-closed)
    const rlPw = await rl(
      `pw:${input.code}:${ipHash}`,
      LIMITS.password.windowSeconds,
      LIMITS.password.limit,
      { failClosed: true, db },
    );
    if (!rlPw.allowed) {
      return { status: "rate_limited", retryAfter: rlPw.retryAfter };
    }

    const pwRes = await verifyPassword(input.password, row.password_hash);
    if (!pwRes.ok) {
      return { status: "wrong" };
    }

    // Best-effort upgrade of legacy/low-iteration hash
    if (pwRes.needsUpgrade) {
      hashPassword(input.password)
        .then((upgradedHash) =>
          db.from("short_links").update({ password_hash: upgradedHash }).eq("code", input.code),
        )
        .catch(() => {});
    }
  }

  // 7. Return destination or pending interstitial
  if (row.status === "pending_review") {
    return { status: "pending_review", url: row.url };
  }

  // Durably register click for active links
  try {
    await db.rpc("register_click", { p_code: input.code });
  } catch {
    // Non-fatal if click counting fails
  }

  return { status: "ok", url: row.url };
}

// ---------------------------------------------------------------------------
// 3. getLinkInfo
// ---------------------------------------------------------------------------

export interface GetLinkInfoInput {
  code: string;
  creatorToken: string;
}

export type GetLinkInfoResult =
  | {
      ok: true;
      link: {
        code: string;
        url: string;
        status: string;
        clicks: number;
        createdAt: string;
        expiresAt: string | null;
        hasPassword: boolean;
        lastClickedAt: string | null;
      };
    }
  | { ok: false; error: "not_found" | "unauthorized" | "rate_limited" };

export async function getLinkInfoService(
  input: GetLinkInfoInput,
  deps?: ServiceDeps,
): Promise<GetLinkInfoResult> {
  const db = await getAdminDb(deps);
  const req = await resolveRequest(deps);
  const rl = deps?.rateLimitFn ?? rateLimit;

  // Rate limit
  const ip = req ? getClientIp(req) : null;
  const ipHash = ip ? hashIp(ip) : "anonymous";
  const rlRes = await rl(
    `creator:${ipHash}`,
    LIMITS.creatorManage.windowSeconds,
    LIMITS.creatorManage.limit,
    { failClosed: true, db },
  );
  if (!rlRes.allowed) {
    return { ok: false, error: "rate_limited" };
  }

  const { data: row } = await db
    .from("short_links")
    .select("*")
    .eq("code", input.code)
    .maybeSingle();

  if (!row) {
    return { ok: false, error: "not_found" };
  }

  if (!verifyCreatorToken(input.creatorToken, row.creator_token_hash)) {
    return { ok: false, error: "unauthorized" };
  }

  return {
    ok: true,
    link: {
      code: row.code,
      url: row.url,
      status: row.status,
      clicks: row.clicks,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      hasPassword: Boolean(row.password_hash),
      lastClickedAt: row.last_clicked_at,
    },
  };
}

// ---------------------------------------------------------------------------
// 4. updateLink & disableLink
// ---------------------------------------------------------------------------

export interface UpdateLinkInput {
  code: string;
  creatorToken: string;
  status?: "active" | "disabled";
  expiresAt?: string | null;
  password?: string | null;
}

export type UpdateLinkResult =
  | {
      ok: true;
      link: {
        code: string;
        status: string;
        expiresAt: string | null;
        hasPassword: boolean;
      };
    }
  | {
      ok: false;
      error:
        | "not_found"
        | "unauthorized"
        | "invalid_request"
        | "forbidden_status_transition"
        | "rate_limited";
    };

export async function updateLinkService(
  input: UpdateLinkInput,
  deps?: ServiceDeps,
): Promise<UpdateLinkResult> {
  const db = await getAdminDb(deps);
  const req = await resolveRequest(deps);
  const now = deps?.now ? deps.now() : new Date();
  const rl = deps?.rateLimitFn ?? rateLimit;

  // Rate limit
  const ip = req ? getClientIp(req) : null;
  const ipHash = ip ? hashIp(ip) : "anonymous";
  const rlRes = await rl(
    `creator:${ipHash}`,
    LIMITS.creatorManage.windowSeconds,
    LIMITS.creatorManage.limit,
    { failClosed: true, db },
  );
  if (!rlRes.allowed) {
    return { ok: false, error: "rate_limited" };
  }

  const { data: row } = await db
    .from("short_links")
    .select("*")
    .eq("code", input.code)
    .maybeSingle();

  if (!row) {
    return { ok: false, error: "not_found" };
  }

  if (!verifyCreatorToken(input.creatorToken, row.creator_token_hash)) {
    return { ok: false, error: "unauthorized" };
  }

  // Creator status transition rules
  if (input.status) {
    if (input.status !== "active" && input.status !== "disabled") {
      return { ok: false, error: "forbidden_status_transition" };
    }
    // Creator cannot re-activate or modify links that are blocked or pending_review
    if (row.status === "blocked" || row.status === "pending_review") {
      return { ok: false, error: "forbidden_status_transition" };
    }
  }

  interface ShortLinkUpdates {
    status?: "active" | "disabled";
    expires_at?: string | null;
    password_hash?: string | null;
    updated_at: string;
  }

  const updates: ShortLinkUpdates = {
    updated_at: now.toISOString(),
  };

  if (input.status) {
    updates.status = input.status;
  }

  if (input.expiresAt !== undefined) {
    if (input.expiresAt === null) {
      updates.expires_at = null;
    } else {
      const expDate = new Date(input.expiresAt);
      if (isNaN(expDate.getTime()) || expDate <= now) {
        return { ok: false, error: "invalid_request" };
      }
      updates.expires_at = expDate.toISOString();
    }
  }

  if (input.password !== undefined) {
    if (input.password === null) {
      updates.password_hash = null;
    } else {
      if (
        typeof input.password !== "string" ||
        input.password.length < 4 ||
        input.password.length > 100
      ) {
        return { ok: false, error: "invalid_request" };
      }
      updates.password_hash = await hashPassword(input.password);
    }
  }

  const { error } = await db.from("short_links").update(updates).eq("code", input.code);
  if (error) {
    return { ok: false, error: "invalid_request" };
  }

  return {
    ok: true,
    link: {
      code: row.code,
      status: updates.status ?? row.status,
      expiresAt: updates.expires_at !== undefined ? updates.expires_at : row.expires_at,
      hasPassword:
        updates.password_hash !== undefined
          ? Boolean(updates.password_hash)
          : Boolean(row.password_hash),
    },
  };
}

export function disableLinkService(
  input: { code: string; creatorToken: string },
  deps?: ServiceDeps,
): Promise<UpdateLinkResult> {
  return updateLinkService({ ...input, status: "disabled" }, deps);
}

// ---------------------------------------------------------------------------
// 5. reportLink
// ---------------------------------------------------------------------------

export interface ReportLinkInput {
  code: string;
  reason: "phishing" | "malware" | "spam" | "illegal" | "other";
  details?: string;
}

export type ReportLinkResult =
  | { ok: true; alreadyReported?: boolean }
  | {
      ok: false;
      error: "link_not_found" | "unverified_client" | "rate_limited" | "server_error";
      retryAfter?: number;
    };

export async function reportLinkService(
  input: ReportLinkInput,
  deps?: ServiceDeps,
): Promise<ReportLinkResult> {
  const db = await getAdminDb(deps);
  const req = await resolveRequest(deps);
  const rl = deps?.rateLimitFn ?? rateLimit;
  const getIdentity = deps?.getIdentityFn ?? getReporterIdentity;

  if (!req) {
    return { ok: false, error: "unverified_client" };
  }

  const identity = getIdentity(req);
  if (identity.kind === "none") {
    return { ok: false, error: "unverified_client" };
  }

  let reporterHash: string;
  if (identity.kind === "ip") {
    const rlRes = await rl(
      `report_ip:${identity.hash}`,
      LIMITS.report.windowSeconds,
      LIMITS.report.limit,
      { failClosed: true, db },
    );
    if (!rlRes.allowed) {
      return { ok: false, error: "rate_limited", retryAfter: rlRes.retryAfter };
    }
    reporterHash = identity.hash;
  } else {
    // Session identity
    const rlRes = await rl(
      `report_session:${identity.sessionId}`,
      LIMITS.reportSession.windowSeconds,
      LIMITS.reportSession.limit,
      { failClosed: true, db },
    );
    if (!rlRes.allowed) {
      return { ok: false, error: "rate_limited", retryAfter: rlRes.retryAfter };
    }
    reporterHash = `unverified:${identity.sessionId}`;
  }

  const details = input.details ? input.details.slice(0, 1000) : null;

  try {
    const { data, error } = await db.rpc("submit_link_report", {
      p_code: input.code,
      p_reason: input.reason,
      p_details: details,
      p_reporter_hash: reporterHash,
    });

    if (error || !data || data.length === 0) {
      return { ok: false, error: "server_error" };
    }

    const row = data[0];
    if (!row.ok) {
      return { ok: false, error: "link_not_found" };
    }

    console.info(
      JSON.stringify({
        event: "report_filed",
        code: input.code,
        reason: input.reason,
        escalated: Boolean(row.escalated),
        is_unverified: reporterHash.startsWith("unverified:"),
      }),
    );

    return {
      ok: true,
      alreadyReported: Boolean(row.already_reported),
    };
  } catch {
    return { ok: false, error: "server_error" };
  }
}
