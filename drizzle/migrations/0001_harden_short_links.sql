-- Migration: 0001_harden_short_links.sql
-- Description: Evolve short_links table, create link_reports, blocked_domains, rate_limits,
--              and atomic stored functions with strict security hardening.

ALTER TABLE public.short_links
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'blocked', 'pending_review')),
  ADD COLUMN IF NOT EXISTS creator_token_hash text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_clicked_at timestamptz,
  ADD COLUMN IF NOT EXISTS target_host text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'short_links_url_length'
  ) THEN
    ALTER TABLE public.short_links
      ADD CONSTRAINT short_links_url_length CHECK (char_length(url) <= 2048) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'short_links_expiry_order'
  ) THEN
    ALTER TABLE public.short_links
      ADD CONSTRAINT short_links_expiry_order CHECK (expires_at IS NULL OR expires_at > created_at) NOT VALID;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS short_links_status_idx ON public.short_links (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS short_links_expires_at_idx ON public.short_links (expires_at)
  WHERE expires_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS short_links_target_host_idx ON public.short_links (target_host);
--> statement-breakpoint
UPDATE public.short_links
   SET target_host = substring(url from '^https?://([^/:]+)')
 WHERE target_host IS NULL AND url ~ '^https?://';
--> statement-breakpoint
REVOKE ALL ON TABLE public.short_links FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.short_links FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.short_links FROM authenticated;
  END IF;
END $$;
--> statement-breakpoint
GRANT ALL ON TABLE public.short_links TO service_role;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.link_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL REFERENCES public.short_links(code) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('phishing', 'malware', 'spam', 'illegal', 'other')),
  details text CHECK (char_length(details) <= 1000),
  reporter_hash text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'actioned', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT link_reports_code_reporter_unique UNIQUE (code, reporter_hash)
);
--> statement-breakpoint
ALTER TABLE public.link_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.link_reports FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.link_reports FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.link_reports FROM authenticated;
  END IF;
END $$;
--> statement-breakpoint
GRANT ALL ON TABLE public.link_reports TO service_role;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS link_reports_code_status_idx ON public.link_reports (code, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.blocked_domains (
  domain text PRIMARY KEY,
  source text NOT NULL DEFAULT 'manual',
  added_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE public.blocked_domains ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.blocked_domains FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.blocked_domains FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.blocked_domains FROM authenticated;
  END IF;
END $$;
--> statement-breakpoint
GRANT ALL ON TABLE public.blocked_domains TO service_role;
--> statement-breakpoint
INSERT INTO public.blocked_domains (domain, source) VALUES
  ('malware-example.test', 'seed'),
  ('phishing-example.test', 'seed')
ON CONFLICT (domain) DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count int NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
--> statement-breakpoint
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.rate_limits FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.rate_limits FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.rate_limits FROM authenticated;
  END IF;
END $$;
--> statement-breakpoint
GRANT ALL ON TABLE public.rate_limits TO service_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_key text,
  p_window_seconds int,
  p_limit int
) RETURNS TABLE(allowed bool, remaining int, retry_after int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_window timestamptz;
  v_count int;
  v_elapsed int;
BEGIN
  -- Strict parameter validation
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'p_window_seconds must be a positive integer';
  END IF;
  IF p_limit IS NULL OR p_limit <= 0 THEN
    RAISE EXCEPTION 'p_limit must be a positive integer';
  END IF;
  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'p_key cannot be empty';
  END IF;

  -- Epoch-aligned fixed time window
  v_window := date_trunc('second', now())
    - (EXTRACT(EPOCH FROM now())::bigint % p_window_seconds) * interval '1 second';

  INSERT INTO public.rate_limits (key, window_start, count)
    VALUES (p_key, v_window, 1)
    ON CONFLICT (key, window_start)
    DO UPDATE SET count = public.rate_limits.count + 1
    RETURNING count INTO v_count;

  v_elapsed := EXTRACT(EPOCH FROM (now() - v_window))::int;

  RETURN QUERY SELECT
    (v_count <= p_limit) AS allowed,
    GREATEST(0, p_limit - v_count)::int AS remaining,
    CASE WHEN v_count > p_limit
      THEN GREATEST(1, p_window_seconds - v_elapsed)::int
      ELSE 0::int
    END AS retry_after;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, int, int) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.rate_limit_hit(text, int, int) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.rate_limit_hit(text, int, int) FROM authenticated;
  END IF;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, int, int) TO service_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.register_click(p_code text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.short_links
     SET clicks = clicks + 1,
         last_clicked_at = now()
   WHERE code = p_code
     AND status IN ('active', 'pending_review')
     AND (expires_at IS NULL OR expires_at > now());
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.register_click(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.register_click(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.register_click(text) FROM authenticated;
  END IF;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.register_click(text) TO service_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.submit_link_report(
  p_code text,
  p_reason text,
  p_details text,
  p_reporter_hash text
) RETURNS TABLE(ok bool, already_reported bool, escalated bool)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_open_count int;
BEGIN
  -- 1. Acquire row lock on short_links to serialize moderation and report concurrency
  SELECT status INTO v_status
    FROM public.short_links
   WHERE code = p_code
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, false, false;
    RETURN;
  END IF;

  -- 2. Insert report with deduplication handling
  BEGIN
    INSERT INTO public.link_reports (code, reason, details, reporter_hash, status)
      VALUES (p_code, p_reason, p_details, p_reporter_hash, 'open');
  EXCEPTION WHEN unique_violation THEN
    -- Already reported by this verified reporter hash
    RETURN QUERY SELECT true, true, false;
    RETURN;
  END;

  -- 3. Calculate open verified reports while holding the short_links lock
  SELECT COUNT(DISTINCT lr.reporter_hash)::int INTO v_open_count
    FROM public.link_reports lr
   WHERE lr.code = p_code
     AND lr.status = 'open'
     AND lr.reporter_hash NOT LIKE 'unverified:%';

  -- 4. Transition to pending_review if threshold reached and currently active
  IF v_open_count >= 3 AND v_status = 'active' THEN
    UPDATE public.short_links
       SET status = 'pending_review',
           updated_at = now()
     WHERE code = p_code;
    RETURN QUERY SELECT true, false, true;
  ELSE
    RETURN QUERY SELECT true, false, false;
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.submit_link_report(text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.submit_link_report(text, text, text, text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.submit_link_report(text, text, text, text) FROM authenticated;
  END IF;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.submit_link_report(text, text, text, text) TO service_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.admin_restore_link(p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing text;
BEGIN
  -- 1. Acquire same row lock order on short_links
  SELECT status INTO v_existing
    FROM public.short_links
   WHERE code = p_code
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 2. Atomically update link status and transition open reports to reviewed
  UPDATE public.short_links
     SET status = 'active',
         updated_at = now()
   WHERE code = p_code;

  UPDATE public.link_reports
     SET status = 'reviewed'
   WHERE code = p_code
     AND status = 'open';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_restore_link(text) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.admin_restore_link(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.admin_restore_link(text) FROM authenticated;
  END IF;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_restore_link(text) TO service_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH deleted AS (
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '2 hours'
    RETURNING 1
  )
  SELECT count(*)::int FROM deleted;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.cleanup_rate_limits() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.cleanup_rate_limits() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.cleanup_rate_limits() FROM authenticated;
  END IF;
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits() TO service_role;
