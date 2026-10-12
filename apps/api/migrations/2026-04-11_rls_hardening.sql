-- ============================================================================
-- Migration: RLS Hardening for Invoice + Email-Bot Tables
-- Date:      2026-04-11
-- Author:    platform team
-- Purpose:   Address AP Invoice Module code review finding on Supabase RLS.
--
--            Before:
--              - 18 tables had RLS enabled but ZERO policies defined → any
--                connection NOT bypassing RLS would be denied access entirely.
--              - 7 tables had RLS disabled → inconsistent schema.
--              - Backend connects as `postgres` with rolbypassrls=true, so
--                the current config works BUT is brittle. A connection
--                rotation or accidental use of `anon`/`authenticated` role
--                would break everything (as happened on 3/19/2026).
--
--            After:
--              - RLS enabled on ALL 25 public-schema tables.
--              - Explicit "service_role + postgres" permissive policy on
--                each table (they still bypass via rolbypassrls, but the
--                policy makes the intent visible and audit-friendly).
--              - `anon` and `authenticated` roles have NO policies and are
--                thus denied by default (they're never used today, this is
--                defense-in-depth).
--
--            This migration is SAFE because:
--              - postgres role has rolbypassrls=true → unaffected by RLS
--              - service_role has rolbypassrls=true → unaffected by RLS
--              - No other role is used by any backend
--              - The policies are additive — they do not remove access
--
-- How to run:  See scripts/tmp-rls-apply.js
-- How to audit: See scripts/tmp-rls-audit.js (run before + after)
-- ============================================================================

BEGIN;

-- ─── 1. Enable RLS on the 7 tables that didn't have it ────────────────────
-- These were left off historically. For consistency, enable everywhere.
ALTER TABLE public.digest_sends          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimates             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pinned_jobs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcontract_feedback  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thread_facts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_feedback       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_item_aliases     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_item_anti_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_items            ENABLE ROW LEVEL SECURITY;

-- ─── 2. Create permissive "service_role + postgres" policy on every table ──
-- One policy per table. Each grants full access ONLY to the two trusted
-- roles, documenting the intent explicitly. All other roles (including
-- anon and authenticated) have no matching policy and are thus denied.
--
-- We use DROP POLICY IF EXISTS + CREATE POLICY so this migration is
-- idempotent — running it twice is safe.

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    -- Invoice pipeline tables
    'audit_log',
    'custom_classifications',
    'digest_sends',
    'documents',
    'estimates',
    'ignore_rules',
    'pinned_jobs',
    'pipeline_errors',
    'processed_emails',
    'processing_queue',
    'retention_settings',
    'rules',
    'subcontract_feedback',
    'subcontract_mappings',
    'vendor_feedback',
    'vendor_mappings',
    -- Email-bot pipeline tables (shared Supabase project)
    'email_filter_rules',
    'email_project_aliases',
    'email_sync_status',
    'emails',
    'thread_facts',
    'thread_summaries',
    'work_item_aliases',
    'work_item_anti_merges',
    'work_items'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Drop existing policy if present so we can re-apply cleanly
    EXECUTE format(
      'DROP POLICY IF EXISTS service_role_full_access ON public.%I',
      tbl
    );
    -- Grant full access to both trusted roles
    EXECUTE format(
      'CREATE POLICY service_role_full_access ON public.%I '
      'FOR ALL TO postgres, service_role '
      'USING (true) WITH CHECK (true)',
      tbl
    );
  END LOOP;
END $$;

COMMIT;

-- ─── Post-migration verification (read-only queries) ──────────────────────
-- Run these to confirm the migration landed cleanly:
--
-- 1) All public tables should have rls_enabled = true:
--      SELECT relname, relrowsecurity FROM pg_class c
--      JOIN pg_namespace n ON n.oid = c.relnamespace
--      WHERE n.nspname='public' AND c.relkind='r'
--      ORDER BY relname;
--
-- 2) Each table should have exactly one policy named service_role_full_access:
--      SELECT tablename, policyname, roles, cmd
--      FROM pg_policies
--      WHERE schemaname='public'
--      ORDER BY tablename;
--
-- 3) All invoice pipeline API endpoints should continue to return 200
--    for authenticated calls. Run smoke tests.
