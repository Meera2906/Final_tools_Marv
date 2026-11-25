import { createFileRoute, Link, redirect, notFound } from "@tanstack/react-router";
import { useState } from "react";
import {
  Lock,
  AlertTriangle,
  ExternalLink,
  Flag,
  ArrowRight,
  ShieldAlert,
  Clock,
  Ban,
  CheckCircle2,
} from "lucide-react";
import { resolveShortLink, reportLink } from "@/lib/links.functions";

export const Route = createFileRoute("/go/$code")({
  staleTime: 0,
  gcTime: 0,
  headers: () => ({
    "Cache-Control": "no-store, no-cache, must-revalidate",
  }),
  loader: async ({ params }: { params: { code: string } }) => {
    const res = await resolveShortLink({ data: { code: params.code } });

    // 1. Clean active link: emit server HTTP 302 redirect immediately
    if (res.status === "ok") {
      throw redirect({
        href: res.url,
        statusCode: 302,
        headers: {
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Robots-Tag": "noindex",
        },
      });
    }

    if (res.status === "missing") {
      throw notFound();
    }

    // 2. Non-redirect states return data to render appropriate UI Shell
    return res;
  },
  notFoundComponent: () => (
    <Shell
      icon={<ExternalLink className="h-10 w-10 text-muted-foreground" />}
      title="Link not found"
    >
      <p className="max-w-md text-sm text-muted-foreground">
        We couldn't find a short link matching this URL code. Check the spelling or create a new
        one.
      </p>
      <Link to="/$slug" params={{ slug: "link-shortener" }} className="btn-primary">
        Make your own short link
      </Link>
    </Shell>
  ),
  server: {
    handlers: {
      GET: async ({ next }) => {
        const result = await next();
        const { getResponseStatus } = await import("@tanstack/react-start/server");
        const desiredStatus = getResponseStatus();
        if (desiredStatus && desiredStatus !== 200 && result.response.status === 200) {
          return new Response(result.response.body, {
            status: desiredStatus,
            headers: result.response.headers,
          });
        }
        return result;
      },
      POST: async ({ request, params }: { request: Request; params: { code: string } }) => {
        const { handleGoPostService } = await import("@/lib/links/service.server");
        return handleGoPostService(request, params.code);
      },
    },
  },
  head: () => ({
    meta: [
      { title: "Opening your link | Marvedge Link Shortener" },
      {
        name: "description",
        content: "A short link created with the free Marvedge Link Shortener.",
      },
      { property: "og:title", content: "Opening your link | Marvedge" },
      {
        property: "og:description",
        content: "A short link created with the free Marvedge Link Shortener.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: Go,
});

function Go() {
  const data = Route.useLoaderData();
  const { code } = Route.useParams();

  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reporting dialog state
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState<
    "phishing" | "malware" | "spam" | "illegal" | "other"
  >("spam");
  const [reportDetails, setReportDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportBusy(true);
    setReportError(null);
    try {
      const res = await reportLink({
        data: {
          code,
          reason: reportReason,
          details: reportDetails.trim() || undefined,
        },
      });
      if (res.ok) {
        setReportSuccess(true);
      } else {
        setReportError(
          res.error === "rate_limited"
            ? "Too many reports. Please try again later."
            : "Unable to submit report.",
        );
      }
    } catch {
      setReportError("Network error. Please try again.");
    } finally {
      setReportBusy(false);
    }
  };

  // 1. Password Protected Links
  if (data.status === "password" || data.status === "password_pending_review") {
    const isPending = data.status === "password_pending_review";

    const unlock = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = e.currentTarget;
      setBusy(true);
      setMsg(null);
      try {
        const r = await resolveShortLink({ data: { code, password: pw } });
        if (r.status === "ok") {
          // Native form submission to let the server emit genuine 302 redirect
          form.submit();
        } else if (r.status === "pending_review") {
          // Flagged link unlocked: submit form to show interstitial
          form.submit();
        } else if (r.status === "wrong") {
          setMsg("Wrong password. Please try again.");
        } else if (r.status === "rate_limited") {
          setMsg(`Too many attempts. Please try again in ${r.retryAfter}s.`);
        } else {
          setMsg("This link is no longer available.");
        }
      } catch {
        // Fallback to native POST
        form.submit();
      } finally {
        setBusy(false);
      }
    };

    return (
      <Shell
        icon={<Lock className="h-10 w-10 text-primary" />}
        title="This link is password protected"
      >
        {isPending && (
          <div className="mb-2 flex max-w-md items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-sm text-amber-500">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>
              This link has been flagged for community review. Please unlock with password to
              inspect destination.
            </span>
          </div>
        )}

        <form method="post" onSubmit={unlock} className="flex w-full max-w-sm flex-col gap-3">
          <input type="hidden" name="action" value="unlock" />
          <input
            type="password"
            name="password"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Enter password"
            className="rounded-xl border bg-background px-3 py-2.5 outline-none focus:border-primary"
            required
          />
          <button type="submit" className="btn-primary justify-center" disabled={busy || !pw}>
            <Lock className="h-4 w-4" /> {busy ? "Checking…" : "Unlock"}
          </button>
          {msg && <p className="text-sm text-destructive">{msg}</p>}
        </form>

        <ReportTrigger onOpen={() => setShowReport(true)} />
        {showReport && (
          <ReportModal
            code={code}
            reason={reportReason}
            setReason={setReportReason}
            details={reportDetails}
            setDetails={setReportDetails}
            busy={reportBusy}
            success={reportSuccess}
            error={reportError}
            onSubmit={handleReportSubmit}
            onClose={() => setShowReport(false)}
          />
        )}
      </Shell>
    );
  }

  // 2. Flagged Link Interstitial Notice (Unlocked or unpassworded)
  if (data.status === "pending_review") {
    return (
      <Shell
        icon={<AlertTriangle className="h-10 w-10 text-amber-500" />}
        title="Community Review Warning"
      >
        <div className="max-w-md space-y-3 text-sm text-muted-foreground">
          <p>
            This link was reported by visitors and is currently undergoing review. Please verify the
            destination URL carefully before continuing.
          </p>

          <div className="rounded-xl border bg-muted/40 p-3 text-left">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Destination
            </span>
            <p className="mt-1 break-all font-mono text-sm text-foreground">{data.url}</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3 w-full max-w-sm">
          <form method="post" className="w-full">
            <input type="hidden" name="action" value="continue" />
            <button type="submit" className="btn-primary w-full justify-center">
              Continue to destination <ArrowRight className="h-4 w-4" />
            </button>
          </form>
          <Link
            to="/$slug"
            params={{ slug: "link-shortener" }}
            className="rounded-xl border bg-background px-4 py-2.5 text-sm font-medium hover:bg-muted w-full text-center"
          >
            Return to safety
          </Link>
        </div>

        <ReportTrigger onOpen={() => setShowReport(true)} />
        {showReport && (
          <ReportModal
            code={code}
            reason={reportReason}
            setReason={setReportReason}
            details={reportDetails}
            setDetails={setReportDetails}
            busy={reportBusy}
            success={reportSuccess}
            error={reportError}
            onSubmit={handleReportSubmit}
            onClose={() => setShowReport(false)}
          />
        )}
      </Shell>
    );
  }

  // 3. Expired Link (410)
  if (data.status === "expired") {
    return (
      <Shell
        icon={<Clock className="h-10 w-10 text-muted-foreground" />}
        title="This short link has expired"
      >
        <p className="max-w-md text-sm text-muted-foreground">
          The creator configured an expiration date for this link, which has now passed.
        </p>
        <Link to="/$slug" params={{ slug: "link-shortener" }} className="btn-primary">
          Make your own short link
        </Link>
      </Shell>
    );
  }

  // 4. Disabled Link (410)
  if (data.status === "disabled") {
    return (
      <Shell
        icon={<Ban className="h-10 w-10 text-muted-foreground" />}
        title="This link has been disabled"
      >
        <p className="max-w-md text-sm text-muted-foreground">
          The creator of this link has turned it off.
        </p>
        <Link to="/$slug" params={{ slug: "link-shortener" }} className="btn-primary">
          Make your own short link
        </Link>
      </Shell>
    );
  }

  // 5. Blocked Link (410)
  if (data.status === "blocked") {
    return (
      <Shell
        icon={<ShieldAlert className="h-10 w-10 text-destructive" />}
        title="This link has been removed"
      >
        <p className="max-w-md text-sm text-muted-foreground">
          This link violates Marvedge community guidelines or points to a blocked domain.
        </p>
        <Link to="/$slug" params={{ slug: "link-shortener" }} className="btn-primary">
          Make your own short link
        </Link>
      </Shell>
    );
  }

  // 6. Rate Limited (429)
  if (data.status === "rate_limited") {
    return (
      <Shell
        icon={<AlertTriangle className="h-10 w-10 text-amber-500" />}
        title="Too many requests"
      >
        <p className="max-w-md text-sm text-muted-foreground">
          You have made too many requests recently. Please wait a moment and refresh.
        </p>
        <Link to="/$slug" params={{ slug: "link-shortener" }} className="btn-primary">
          Back to Link Shortener
        </Link>
      </Shell>
    );
  }

  // 7. Not Found (404)
  return (
    <Shell
      icon={<ExternalLink className="h-10 w-10 text-muted-foreground" />}
      title="Link not found"
    >
      <p className="max-w-md text-sm text-muted-foreground">
        We couldn't find a short link matching this URL code. Check the spelling or create a new
        one.
      </p>
      <Link to="/$slug" params={{ slug: "link-shortener" }} className="btn-primary">
        Make your own short link
      </Link>
    </Shell>
  );
}

function Shell({
  icon,
  title,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-hero flex min-h-[70vh] flex-col items-center justify-center gap-6 px-4 py-20 text-center">
      {icon && <div className="rounded-2xl border bg-background/80 p-4 shadow-sm">{icon}</div>}
      <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}

function ReportTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors mt-2"
    >
      <Flag className="h-3.5 w-3.5" />
      <span>Report this link</span>
    </button>
  );
}

function ReportModal({
  code,
  reason,
  setReason,
  details,
  setDetails,
  busy,
  success,
  error,
  onSubmit,
  onClose,
}: {
  code: string;
  reason: "phishing" | "malware" | "spam" | "illegal" | "other";
  setReason: (r: "phishing" | "malware" | "spam" | "illegal" | "other") => void;
  details: string;
  setDetails: (d: string) => void;
  busy: boolean;
  success: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border bg-background p-6 shadow-xl text-left">
        <div className="flex items-center justify-between pb-4 border-b">
          <h2 className="text-lg font-bold">Report link /{code}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
          >
            ✕
          </button>
        </div>

        {success ? (
          <div className="py-6 text-center space-y-3">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
            <p className="font-medium text-foreground">Report submitted</p>
            <p className="text-sm text-muted-foreground">
              Thank you for keeping our platform safe. Our moderation system will review this link.
            </p>
            <button type="button" onClick={onClose} className="btn-primary justify-center mt-2">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Reason for report
              </label>
              <div className="mt-2 space-y-2">
                {(
                  [
                    { id: "spam", label: "Spam or unsolicited marketing" },
                    { id: "phishing", label: "Phishing or credential theft" },
                    { id: "malware", label: "Malware, virus, or unwanted software" },
                    { id: "illegal", label: "Illegal content or piracy" },
                    { id: "other", label: "Other policy violation" },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.id}
                    className="flex items-center gap-2.5 rounded-lg border p-2.5 text-sm hover:bg-muted/50 cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="reason"
                      value={opt.id}
                      checked={reason === opt.id}
                      onChange={() => setReason(opt.id)}
                      className="text-primary"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Additional details (optional)
              </label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={500}
                placeholder="Describe why this link is abusive..."
                className="mt-1.5 w-full rounded-xl border bg-background p-2.5 text-sm outline-none focus:border-primary resize-none h-20"
              />
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
              <button type="submit" disabled={busy} className="btn-primary">
                {busy ? "Submitting…" : "Submit report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
