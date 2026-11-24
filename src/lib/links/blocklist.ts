/**
 * Domain blocklist matcher and reputation provider interface.
 * DESIGN.md §6.2 & §10.1
 */

/**
 * Normalizes a hostname for blocklist comparison (lowercased, stripped of trailing dots and whitespace).
 */
function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/\.+$/, "");
}

/**
 * Checks whether a given host matches any entry in the blocked domains list.
 * Supports exact matches ("evil.com") and subdomain/parent-domain matches ("sub.evil.com"),
 * while preventing false suffix collisions ("notevil.com" != "evil.com").
 */
export function isBlockedHost(host: string, blocked: Iterable<string>): boolean {
  if (typeof host !== "string" || host.length === 0) {
    return false;
  }

  const normalizedHost = normalizeDomain(host);
  if (!normalizedHost) return false;

  for (const item of blocked) {
    if (typeof item !== "string") continue;
    const blockedDomain = normalizeDomain(item);
    if (!blockedDomain) continue;

    // Exact match: evil.com == evil.com
    if (normalizedHost === blockedDomain) {
      return true;
    }

    // Subdomain match: sub.evil.com ends with .evil.com
    if (normalizedHost.endsWith("." + blockedDomain)) {
      return true;
    }
  }

  return false;
}

export interface UrlReputationProvider {
  check(url: string): Promise<{ safe: boolean; reason?: string }>;
}

export const noopReputationProvider: UrlReputationProvider = {
  async check(_url: string): Promise<{ safe: boolean; reason?: string }> {
    return { safe: true };
  },
};
