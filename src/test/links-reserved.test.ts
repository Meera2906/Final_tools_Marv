import { describe, it, expect } from "vitest";
import { isReservedSlug, validateSlugFormat } from "@/lib/links/reserved";
import { tools } from "@/lib/tools";
import fs from "node:fs";
import path from "node:path";

describe("reserved slugs: validateSlugFormat & isReservedSlug", () => {
  it("validates valid and invalid slug formats", () => {
    // Valid: 3 to 40 chars, [A-Za-z0-9_-]
    expect(validateSlugFormat("abc")).toBe(true);
    expect(validateSlugFormat("my_cool-link_123")).toBe(true);
    expect(validateSlugFormat("A".repeat(40))).toBe(true);

    // Invalid length
    expect(validateSlugFormat("ab")).toBe(false);
    expect(validateSlugFormat("A".repeat(41))).toBe(false);
    expect(validateSlugFormat("")).toBe(false);

    // Invalid characters
    expect(validateSlugFormat("abc.def")).toBe(false);
    expect(validateSlugFormat("abc/def")).toBe(false);
    expect(validateSlugFormat("abc def")).toBe(false);
    expect(validateSlugFormat("abc@def")).toBe(false);
    expect(validateSlugFormat("abc?def")).toBe(false);
    // @ts-expect-error non-string
    expect(validateSlugFormat(null)).toBe(false);
  });

  it("reserves every single tool slug from tools.ts", () => {
    expect(tools.length).toBeGreaterThanOrEqual(18);
    for (const tool of tools) {
      expect(isReservedSlug(tool.slug), `Tool slug "${tool.slug}" must be reserved`).toBe(true);
      // Case-insensitivity check
      expect(
        isReservedSlug(tool.slug.toUpperCase()),
        `Uppercase tool slug "${tool.slug.toUpperCase()}" must be reserved`,
      ).toBe(true);
    }
  });

  it("reserves system routes, core paths, and lookalikes", () => {
    const samples = [
      "api",
      "admin",
      "go",
      "unlock",
      "blocked",
      "expired",
      "marvedge",
      "g00gle",
      "paypa1",
      "amaz0n",
      "app1e",
      "index",
      "__root",
      "robots",
      "sitemap",
      "favicon",
    ];
    for (const slug of samples) {
      expect(isReservedSlug(slug)).toBe(true);
      expect(isReservedSlug(slug.toUpperCase())).toBe(true);
    }
  });

  it("allows unreserved custom slugs", () => {
    expect(isReservedSlug("marketing-2026")).toBe(false);
    expect(isReservedSlug("v1-launch")).toBe(false);
    expect(isReservedSlug("promo-99")).toBe(false);
  });

  it("completeness test: covers top-level routes and public assets", () => {
    // Check routes directory
    const routesDir = path.resolve(process.cwd(), "src/routes");
    const routeFiles = fs.readdirSync(routesDir);
    for (const file of routeFiles) {
      if (file.startsWith("$") || file.endsWith(".md")) continue;
      const baseName = file.replace(/\..*$/, "");
      expect(isReservedSlug(baseName), `Route file basename "${baseName}" should be reserved`).toBe(
        true,
      );
    }

    // Check public directory
    const publicDir = path.resolve(process.cwd(), "public");
    const publicFiles = fs.readdirSync(publicDir);
    for (const file of publicFiles) {
      if (file.startsWith("_")) continue;
      const baseName = file.split(".")[0];
      if (baseName && baseName.length >= 3) {
        expect(
          isReservedSlug(baseName),
          `Public asset basename "${baseName}" should be reserved`,
        ).toBe(true);
      }
    }
  });
});
