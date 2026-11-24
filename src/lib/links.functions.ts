import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const createShortLink = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        url: z.string().max(2048),
        code: z
          .string()
          .regex(/^[A-Za-z0-9_-]{3,40}$/, "3–40 letters, numbers, - or _")
          .optional(),
        password: z.string().min(4).max(100).optional(),
        expiresAt: z.string().datetime().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { createShortLinkService } = await import("./links/service.server");
    return createShortLinkService(data);
  });

export const resolveShortLink = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        code: z.string().max(40),
        password: z.string().max(100).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { resolveShortLinkService } = await import("./links/service.server");
    return resolveShortLinkService(data);
  });

export const getLinkInfo = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        code: z.string().max(40),
        creatorToken: z.string().max(100),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { getLinkInfoService } = await import("./links/service.server");
    return getLinkInfoService(data);
  });

export const updateLink = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        code: z.string().max(40),
        creatorToken: z.string().max(100),
        status: z.enum(["active", "disabled"]).optional(),
        expiresAt: z.string().datetime().nullable().optional(),
        password: z.string().min(4).max(100).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { updateLinkService } = await import("./links/service.server");
    return updateLinkService(data);
  });

export const disableLink = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        code: z.string().max(40),
        creatorToken: z.string().max(100),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { disableLinkService } = await import("./links/service.server");
    return disableLinkService(data);
  });

export const reportLink = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        code: z.string().max(40),
        reason: z.enum(["phishing", "malware", "spam", "illegal", "other"]),
        details: z.string().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { reportLinkService } = await import("./links/service.server");
    return reportLinkService(data);
  });
