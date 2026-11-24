import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/admin/links/reports")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const { listReportsService } = await import("@/lib/links/admin.server");
        return listReportsService(request);
      },
      PATCH: async ({ request }: { request: Request }) => {
        const { updateReportService } = await import("@/lib/links/admin.server");
        return updateReportService(request);
      },
    },
  },
});
