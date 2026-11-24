/**
 * Target URL safety and validation policy.
 * DESIGN.md §10.1: Destination Safety Validation
 */

export interface ValidateUrlOptions {
  siteHost?: string;
  blockShortenerChains?: boolean;
}

export type ValidateUrlResult =
  | { ok: true; url: string; host: string; flagPendingReview: boolean }
  | { ok: false; reason: string };

const KNOWN_SHORTENERS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "ow.ly",
  "is.gd",
  "buff.ly",
  "adf.ly",
  "bit.do",
  "tiny.cc",
  "goo.gl",
  "cutt.ly",
  "shorte.st",
  "rb.gy",
]);

/**
 * Checks if a string represents an IPv4 address (dotted-decimal).
 */
function isIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = parseInt(part, 10);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

/**
 * Checks if a parsed hostname is an IPv6 address.
 */
function isIPv6(host: string): boolean {
  if (host.startsWith("[") && host.endsWith("]")) return true;
  return host.includes(":") && !host.includes(".");
}

/**
 * Checks if a raw string might be an alternative-format IP (octal, hex, decimal integer).
 */
function isRawNumericHost(rawHost: string): boolean {
  const cleaned = rawHost.replace(/:\d+$/, "");
  // Pure decimal integer IP: e.g. 2130706433
  if (/^\d+$/.test(cleaned)) return true;
  // Hex notation: e.g. 0x7f000001 or 0x7f.1
  if (/^0x[0-9a-fA-F.]*$/i.test(cleaned)) return true;
  // Octal dotted notation: e.g. 0177.0.0.1
  if (/^0[0-7]+(\.[0-7]+)*$/.test(cleaned)) return true;
  return false;
}

/**
 * Validates a destination URL against safety requirements.
 */
export function validateTargetUrl(input: string, opts?: ValidateUrlOptions): ValidateUrlResult {
  if (typeof input !== "string") {
    return { ok: false, reason: "Target URL must be a string" };
  }

  // 1. Length check: max 2048 chars
  if (input.length > 2048) {
    return {
      ok: false,
      reason: "URL exceeds maximum length of 2048 characters",
    };
  }

  // 2. Reject control codes and whitespace
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7F]/.test(input)) {
    return {
      ok: false,
      reason: "URL contains forbidden whitespace or control characters",
    };
  }

  // 3. Pre-parse check for raw non-standard IP formats before WHATWG normalizes them
  try {
    const rawMatch = input.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?([^/?#]+)/);
    if (rawMatch && rawMatch[2]) {
      const rawAuthority = rawMatch[2];
      const rawHost = rawAuthority.split("@").pop()?.split(":")[0] ?? "";
      if (isRawNumericHost(rawHost)) {
        return {
          ok: false,
          reason: "IP address hosts are not allowed",
        };
      }
    }
  } catch {
    // Ignore regex errors, WHATWG will handle formatting
  }

  // 4. Parse with WHATWG URL parser
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, reason: "Invalid URL format" };
  }

  // 5. Scheme check: only http: and https:
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      reason: `Unsupported URL scheme: ${parsed.protocol.replace(":", "")}`,
    };
  }

  // 6. Credentials check
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      reason: "Embedded credentials (username/password) are not permitted",
    };
  }

  // 7. Non-empty host
  const rawHost = parsed.hostname;
  if (!rawHost || rawHost.trim().length === 0) {
    return { ok: false, reason: "URL must contain a valid host" };
  }

  const host = rawHost.toLowerCase();

  // 8. Reject private, loopback, and internal hostnames
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    return {
      ok: false,
      reason: "Private, local, and internal addresses are not allowed",
    };
  }

  // 9. Reject all IP-literal hosts (IPv4, IPv6, IPv4-mapped)
  // WHATWG parser strips brackets for hostname or keeps them depending on platform; check both
  const unbracketed = host.replace(/^\[/, "").replace(/\]$/, "");
  if (isIPv4(host) || isIPv6(host) || isIPv6(unbracketed) || isIPv4(unbracketed)) {
    return {
      ok: false,
      reason: "IP address hosts are not allowed",
    };
  }

  // 10. Self-origin and loop prevention
  if (opts?.siteHost) {
    const siteHostClean = opts.siteHost.toLowerCase().replace(/:\d+$/, "");
    if (host === siteHostClean) {
      if (parsed.pathname.toLowerCase().startsWith("/go/")) {
        return {
          ok: false,
          reason: "Redirection loop to /go/ is not allowed",
        };
      }
      return {
        ok: false,
        reason: "Self-referencing URLs are not allowed",
      };
    }
  }

  // Also block target URLs that point to /go/ path on any domain matching Marvedge
  if (
    (host === "marvedge.com" || host.endsWith(".marvedge.com")) &&
    parsed.pathname.toLowerCase().startsWith("/go/")
  ) {
    return {
      ok: false,
      reason: "Redirection loop to /go/ is not allowed",
    };
  }

  // 11. Optional shortener-chain blocking
  if (opts?.blockShortenerChains) {
    const isShortener =
      KNOWN_SHORTENERS.has(host) ||
      Array.from(KNOWN_SHORTENERS).some((s) => host.endsWith("." + s));
    if (isShortener) {
      return {
        ok: false,
        reason: "Target URL points to another link shortener",
      };
    }
  }

  // 12. Punycode / Homograph detection
  const flagPendingReview = host.includes("xn--");

  // 13. Normalization: strip default ports and empty fragments
  if (parsed.protocol === "http:" && parsed.port === "80") {
    parsed.port = "";
  } else if (parsed.protocol === "https:" && parsed.port === "443") {
    parsed.port = "";
  }

  let finalUrl = parsed.toString();
  // Strip empty fragment if present
  if (finalUrl.endsWith("#")) {
    finalUrl = finalUrl.slice(0, -1);
  }

  return {
    ok: true,
    url: finalUrl,
    host,
    flagPendingReview,
  };
}
