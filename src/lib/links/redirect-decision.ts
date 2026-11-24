/**
 * Pure redirect decision matrix and CSRF origin validation.
 * DESIGN.md §8.2 & Amendment A5
 */

export interface RedirectLinkState {
  status: "active" | "disabled" | "blocked" | "pending_review";
  url: string;
  target_host: string | null;
  expires_at: string | null;
  password_hash: string | null;
}

export interface RedirectDecisionContext {
  code: string;
  link: RedirectLinkState | null;
  now?: Date;
  isHostBlocked?: boolean;
  rateLimitAllowed?: boolean;
  retryAfter?: number;
}

export type RedirectDecision =
  | {
      kind: "redirect";
      status: 302;
      url: string;
      headers: Record<string, string>;
    }
  | { kind: "password"; status: 200 }
  | { kind: "password_pending_review"; status: 200 }
  | { kind: "pending_review"; status: 200; url: string }
  | { kind: "missing"; status: 404 }
  | { kind: "expired"; status: 410 }
  | { kind: "disabled"; status: 410 }
  | { kind: "blocked"; status: 410 }
  | { kind: "rate_limited"; status: 429; retryAfter: number };

/**
 * Pure decision function mapping link state to HTTP status and behavior (DESIGN §8.2).
 */
export function decideRedirect(ctx: RedirectDecisionContext): RedirectDecision {
  // 1. Rate limiting
  if (ctx.rateLimitAllowed === false) {
    return {
      kind: "rate_limited",
      status: 429,
      retryAfter: ctx.retryAfter ?? 60,
    };
  }

  // 2. Missing link
  if (!ctx.link) {
    return { kind: "missing", status: 404 };
  }

  const link = ctx.link;
  const now = ctx.now ?? new Date();

  // 3. Blocked status or dynamic blocked domain
  if (link.status === "blocked" || ctx.isHostBlocked) {
    return { kind: "blocked", status: 410 };
  }

  // 4. Disabled status
  if (link.status === "disabled") {
    return { kind: "disabled", status: 410 };
  }

  // 5. Expired status
  if (link.expires_at && new Date(link.expires_at) <= now) {
    return { kind: "expired", status: 410 };
  }

  // 6. Password evaluation
  if (link.password_hash) {
    if (link.status === "pending_review") {
      // Must NOT disclose URL!
      return { kind: "password_pending_review", status: 200 };
    }
    return { kind: "password", status: 200 };
  }

  // 7. Flagged / pending review without password
  if (link.status === "pending_review") {
    return { kind: "pending_review", status: 200, url: link.url };
  }

  // 8. Clean active redirect
  return {
    kind: "redirect",
    status: 302,
    url: link.url,
    headers: {
      Location: link.url,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
    },
  };
}

/**
 * Validates request origin for native POST submissions (Amendment A5).
 * Origin host must equal request host or PUBLIC_SITE_URL host.
 * Falls back to Sec-Fetch-Site: same-origin or same-site.
 */
export function validatePostOrigin(req: Request, publicSiteUrl?: string): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  const secFetchSite = req.headers.get("sec-fetch-site");

  let publicHost: string | null = null;
  if (publicSiteUrl) {
    try {
      publicHost = new URL(publicSiteUrl).host.toLowerCase();
    } catch {
      publicHost = null;
    }
  }

  // 1. Check Origin header
  if (origin) {
    try {
      const originHost = new URL(origin).host.toLowerCase();
      if (host && originHost === host.toLowerCase()) return true;
      if (publicHost && originHost === publicHost) return true;
      return false;
    } catch {
      return false;
    }
  }

  // 2. Fall back to Sec-Fetch-Site
  if (secFetchSite) {
    return (
      secFetchSite === "same-origin" || secFetchSite === "same-site" || secFetchSite === "none"
    );
  }

  return false;
}
