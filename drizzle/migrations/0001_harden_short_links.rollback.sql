-- Rollback: 0001_harden_short_links.rollback.sql
-- Description: Completely reverses 0001_harden_short_links.sql schema changes and functions.
-- Note: Do NOT execute until the application code has been rolled back in deployment.

DROP FUNCTION IF EXISTS public.admin_restore_link(text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.submit_link_report(text, text, text, text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.cleanup_rate_limits();
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.register_click(text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS public.rate_limit_hit(text, int, int);
--> statement-breakpoint
DROP TABLE IF EXISTS public.rate_limits CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS public.blocked_domains CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS public.link_reports CASCADE;
--> statement-breakpoint
ALTER TABLE public.short_links
  DROP CONSTRAINT IF EXISTS short_links_expiry_order,
  DROP CONSTRAINT IF EXISTS short_links_url_length,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS creator_token_hash,
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS last_clicked_at,
  DROP COLUMN IF EXISTS target_host;
