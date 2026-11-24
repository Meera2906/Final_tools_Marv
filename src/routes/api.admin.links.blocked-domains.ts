import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/links/blocked-domains")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { listBlockedDomainsService } = await import("@/lib/links/admin.server");
        return listBlockedDomainsService(request);
      },
      POST: async ({ request }: { request: Request }) => {
        const { addBlockedDomainService } = await import("@/lib/links/admin.server");
        return addBlockedDomainService(request);
      },
      DELETE: async ({ request }: { request: Request }) => {
        const { removeBlockedDomainService } = await import("@/lib/links/admin.server");
        return removeBlockedDomainService(request);
      },
    },
  },
});
