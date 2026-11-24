import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/links/status")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const { updateLinkStatusService } = await import("@/lib/links/admin.server");
        return updateLinkStatusService(request);
      },
    },
  },
});
