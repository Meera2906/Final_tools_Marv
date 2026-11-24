-- Smoke Test: 0001_smoke.sql
-- Description: Transactional verification suite for 0001_harden_short_links migration.
-- Wrapped in BEGIN ... ROLLBACK to ensure zero persistent side-effects.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Test Legacy Row Survival & Default Values
-- -----------------------------------------------------------------------------
INSERT INTO public.short_links (code, url, clicks)
VALUES ('smoke-legacy-01', 'https://example.com/legacy-test', 0);

DO $$
DECLARE
  v_rec record;
BEGIN
  SELECT status, clicks, created_at, updated_at, target_host
    INTO v_rec
    FROM public.short_links
   WHERE code = 'smoke-legacy-01';

  IF v_rec.status <> 'active' THEN
    RAISE EXCEPTION 'Assertion failed: status should default to active, got %', v_rec.status;
  END IF;
  IF v_rec.clicks <> 0 THEN
    RAISE EXCEPTION 'Assertion failed: clicks should be 0, got %', v_rec.clicks;
  END IF;
  IF v_rec.created_at IS NULL THEN
    RAISE EXCEPTION 'Assertion failed: created_at must not be null';
  END IF;
  RAISE NOTICE 'Test 1 Passed: Legacy row survived with correct defaults.';
END $$;

-- -----------------------------------------------------------------------------
-- 2. Test URL Length Constraint (<= 2048 chars)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_long_url text := 'https://example.com/' || repeat('a', 2040);
BEGIN
  BEGIN
    INSERT INTO public.short_links (code, url) VALUES ('smoke-long-01', v_long_url);
    RAISE EXCEPTION 'Assertion failed: URL exceeding 2048 chars should have been rejected by constraint';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'Test 2 Passed: URL length constraint rejected string > 2048 chars.';
  END;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Test Expiry Order Constraint (expires_at > created_at)
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    INSERT INTO public.short_links (code, url, created_at, expires_at)
    VALUES ('smoke-exp-01', 'https://example.com', now(), now() - interval '1 day');
    RAISE EXCEPTION 'Assertion failed: Past expiry date relative to created_at should have been rejected';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'Test 3 Passed: Expiry order constraint rejected invalid expiry.';
  END;
END $$;

-- -----------------------------------------------------------------------------
-- 4. Test rate_limit_hit Function (Fixed-window accounting & retry_after)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_res1 record;
  v_res2 record;
  v_res3 record;
BEGIN
  -- Hit 1: limit 2
  SELECT * INTO v_res1 FROM public.rate_limit_hit('smoke_test_ip_1', 60, 2);
  IF NOT v_res1.allowed OR v_res1.remaining <> 1 OR v_res1.retry_after <> 0 THEN
    RAISE EXCEPTION 'Assertion failed on hit 1: %', v_res1;
  END IF;

  -- Hit 2: limit 2 (reaches limit)
  SELECT * INTO v_res2 FROM public.rate_limit_hit('smoke_test_ip_1', 60, 2);
  IF NOT v_res2.allowed OR v_res2.remaining <> 0 OR v_res2.retry_after <> 0 THEN
    RAISE EXCEPTION 'Assertion failed on hit 2: %', v_res2;
  END IF;

  -- Hit 3: limit 2 (exceeds limit)
  SELECT * INTO v_res3 FROM public.rate_limit_hit('smoke_test_ip_1', 60, 2);
  IF v_res3.allowed OR v_res3.remaining <> 0 OR v_res3.retry_after <= 0 THEN
    RAISE EXCEPTION 'Assertion failed on hit 3: %', v_res3;
  END IF;

  RAISE NOTICE 'Test 4 Passed: rate_limit_hit correctly tracks limits and retry_after.';
END $$;

-- -----------------------------------------------------------------------------
-- 5. Test register_click Function (Atomic Increment & last_clicked_at)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_clicks int;
  v_last_clicked timestamptz;
BEGIN
  PERFORM public.register_click('smoke-legacy-01');

  SELECT clicks, last_clicked_at INTO v_clicks, v_last_clicked
    FROM public.short_links
   WHERE code = 'smoke-legacy-01';

  IF v_clicks <> 1 OR v_last_clicked IS NULL THEN
    RAISE EXCEPTION 'Assertion failed: register_click did not increment clicks or set timestamp: clicks=%, ts=%', v_clicks, v_last_clicked;
  END IF;

  RAISE NOTICE 'Test 5 Passed: register_click successfully incremented click count.';
END $$;

-- -----------------------------------------------------------------------------
-- 6. Test submit_link_report Deduplication & Escalation
-- -----------------------------------------------------------------------------
INSERT INTO public.short_links (code, url, status)
VALUES ('smoke-report-01', 'https://example.com/reported', 'active');

DO $$
DECLARE
  v_rep record;
  v_status text;
BEGIN
  -- First verified reporter
  SELECT * INTO v_rep FROM public.submit_link_report('smoke-report-01', 'spam', 'Spam link', 'verified_hash_A');
  IF NOT v_rep.ok OR v_rep.already_reported OR v_rep.escalated THEN
    RAISE EXCEPTION 'Assertion failed on report 1: %', v_rep;
  END IF;

  -- Duplicate from same verified reporter
  SELECT * INTO v_rep FROM public.submit_link_report('smoke-report-01', 'spam', 'Duplicate spam link', 'verified_hash_A');
  IF NOT v_rep.ok OR NOT v_rep.already_reported OR v_rep.escalated THEN
    RAISE EXCEPTION 'Assertion failed on duplicate report: %', v_rep;
  END IF;

  -- Unverified reporter report (should NOT count toward threshold)
  SELECT * INTO v_rep FROM public.submit_link_report('smoke-report-01', 'phishing', 'Unverified report', 'unverified:anon_session_1');
  IF NOT v_rep.ok OR v_rep.already_reported OR v_rep.escalated THEN
    RAISE EXCEPTION 'Assertion failed on unverified report: %', v_rep;
  END IF;

  -- Second verified reporter
  SELECT * INTO v_rep FROM public.submit_link_report('smoke-report-01', 'phishing', 'Phishing attempt', 'verified_hash_B');
  IF NOT v_rep.ok OR v_rep.already_reported OR v_rep.escalated THEN
    RAISE EXCEPTION 'Assertion failed on report 2: %', v_rep;
  END IF;

  -- Third verified reporter -> MUST trigger escalation to pending_review
  SELECT * INTO v_rep FROM public.submit_link_report('smoke-report-01', 'malware', 'Malware delivery', 'verified_hash_C');
  IF NOT v_rep.ok OR v_rep.already_reported OR NOT v_rep.escalated THEN
    RAISE EXCEPTION 'Assertion failed on report 3 escalation: %', v_rep;
  END IF;

  SELECT status INTO v_status FROM public.short_links WHERE code = 'smoke-report-01';
  IF v_status <> 'pending_review' THEN
    RAISE EXCEPTION 'Assertion failed: status should be pending_review, got %', v_status;
  END IF;

  RAISE NOTICE 'Test 6 Passed: submit_link_report handles deduplication, unverified isolation, and threshold escalation.';
END $$;

-- -----------------------------------------------------------------------------
-- 7. Test register_click during pending_review
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_clicks int;
BEGIN
  PERFORM public.register_click('smoke-report-01');

  SELECT clicks INTO v_clicks FROM public.short_links WHERE code = 'smoke-report-01';
  IF v_clicks <> 1 THEN
    RAISE EXCEPTION 'Assertion failed: clicks should register for pending_review links, got %', v_clicks;
  END IF;

  RAISE NOTICE 'Test 7 Passed: register_click tracks clicks on pending_review links.';
END $$;

-- -----------------------------------------------------------------------------
-- 8. Test admin_restore_link Reset
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_status text;
  v_open_count int;
BEGIN
  PERFORM public.admin_restore_link('smoke-report-01');

  SELECT status INTO v_status FROM public.short_links WHERE code = 'smoke-report-01';
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'Assertion failed: status should be reset to active, got %', v_status;
  END IF;

  SELECT COUNT(*) INTO v_open_count
    FROM public.link_reports
   WHERE code = 'smoke-report-01' AND status = 'open';

  IF v_open_count <> 0 THEN
    RAISE EXCEPTION 'Assertion failed: open reports should be transitioned to reviewed, remaining=%', v_open_count;
  END IF;

  RAISE NOTICE 'Test 8 Passed: admin_restore_link resets status to active and marks open reports reviewed.';
END $$;

-- -----------------------------------------------------------------------------
-- 9. Test cleanup_rate_limits
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_deleted int;
BEGIN
  SELECT public.cleanup_rate_limits() INTO v_deleted;
  IF v_deleted < 0 THEN
    RAISE EXCEPTION 'Assertion failed: cleanup_rate_limits returned negative count: %', v_deleted;
  END IF;

  RAISE NOTICE 'Test 9 Passed: cleanup_rate_limits executed successfully.';
END $$;

-- -----------------------------------------------------------------------------
-- 10. Test Permission Isolation & Amendment A1
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- If anon role exists in environment, verify it cannot execute stored procedures
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    IF has_function_privilege('anon', 'public.rate_limit_hit(text, int, int)', 'execute') THEN
      RAISE EXCEPTION 'Security assertion failed: anon must NOT have execute on rate_limit_hit';
    END IF;
    IF has_function_privilege('anon', 'public.submit_link_report(text, text, text, text)', 'execute') THEN
      RAISE EXCEPTION 'Security assertion failed: anon must NOT have execute on submit_link_report';
    END IF;
    IF has_table_privilege('anon', 'public.link_reports', 'select') THEN
      RAISE EXCEPTION 'Security assertion failed: anon must NOT have select on link_reports';
    END IF;
  END IF;

  -- Verify service_role has execute privileges
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    IF NOT has_function_privilege('service_role', 'public.rate_limit_hit(text, int, int)', 'execute') THEN
      RAISE EXCEPTION 'Security assertion failed: service_role MUST have execute on rate_limit_hit';
    END IF;
    IF NOT has_table_privilege('service_role', 'public.link_reports', 'select') THEN
      RAISE EXCEPTION 'Security assertion failed: service_role MUST have select on link_reports';
    END IF;
  END IF;

  RAISE NOTICE 'Test 10 Passed: Permission isolation and privilege grants verified.';
END $$;

-- Rollback the entire smoke test transaction so no test data remains
ROLLBACK;
