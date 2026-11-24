/**
 * Reserved slug checking and format validation.
 * DESIGN.md §9.1 & Amendment A3
 */

import { tools } from "@/lib/tools";

const STATIC_RESERVED_SLUGS = [
  // System & standard web paths
  "api",
  "admin",
  "login",
  "logout",
  "signup",
  "auth",
  "report",
  "health",
  "healthz",
  "status",
  "static",
  "assets",
  "favicon",
  "robots",
  "sitemap",
  "well-known",
  "about",
  "terms",
  "privacy",
  "docs",
  "help",
  "support",
  "www",
  "app",
  "dashboard",
  "settings",
  "go",
  "unlock",
  "blocked",
  "expired",
  "marvedge",
  "new",
  "null",
  "undefined",
  "_next",
  "index",
  "__root",
  "llms",
  "marvedge-logo",
  "marvedge-logo-white",

  // Brand impersonation and lookalike deceptive terms
  "paypa1",
  "g00gle",
  "amaz0n",
  "app1e",
] as const;

// Combined reserved set (all lowercased)
const RESERVED_SET: ReadonlySet<string> = new Set<string>([
  ...STATIC_RESERVED_SLUGS.map((s) => s.toLowerCase()),
  ...tools.map((t) => t.slug.toLowerCase()),
]);

const SLUG_FORMAT_REGEX = /^[A-Za-z0-9_-]{3,40}$/;

/**
 * Validates whether a slug matches allowed syntax (3-40 chars, alphanumeric + _ -).
 */
export function validateSlugFormat(slug: string): boolean {
  if (typeof slug !== "string") return false;
  return SLUG_FORMAT_REGEX.test(slug);
}

/**
 * Checks whether a slug is reserved for system routes, tools, or brand protection.
 * Matching is case-insensitive.
 */
export function isReservedSlug(slug: string): boolean {
  if (typeof slug !== "string") return true;
  return RESERVED_SET.has(slug.toLowerCase().trim());
}
