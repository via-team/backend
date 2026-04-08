-- Allow route creators to soft-delete their own routes by setting is_active = false.
--
-- This script replaces the routes UPDATE policy so creator-owned soft-deletes work.
--
-- Supabase/Postgres combines permissive policies with OR semantics, so adding a new
-- policy alone is not enough if an older restrictive policy still requires is_active = true.
-- This script drops the common conflicting UPDATE policies first, then recreates the
-- creator-only policy that allows is_active = false.

DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS routes_update_own_soft_delete ON public.routes';
  EXECUTE 'DROP POLICY IF EXISTS routes_update_own ON public.routes';
  EXECUTE 'DROP POLICY IF EXISTS routes_update_creator_only ON public.routes';
  EXECUTE 'DROP POLICY IF EXISTS routes_update_creator_active_only ON public.routes';
  EXECUTE 'DROP POLICY IF EXISTS routes_update_own_active ON public.routes';
  EXECUTE 'DROP POLICY IF EXISTS routes_update_own_route ON public.routes';

  EXECUTE $policy$
    CREATE POLICY routes_update_own_soft_delete
    ON public.routes
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = creator_id)
    WITH CHECK (auth.uid() = creator_id)
  $policy$;
END
$$;
