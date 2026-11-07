-- V1: Lazarus core schema, profile provisioning trigger, grants, and Row Level Security.
-- Depends on Supabase objects: the auth.users table, the auth uid helper function, and the roles anon and authenticated.
-- Conventions: uuid primary keys, timestamptz timestamps, and the current user id always read through a select subquery.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email text,
  github_username text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.corpses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE,
  is_sample boolean NOT NULL DEFAULT false,
  title text NOT NULL,
  source_language text NOT NULL,
  original_code text NOT NULL,
  code_hash TEXT NOT NULL,
  repo_url text,
  status text NOT NULL DEFAULT 'INFECTED',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corpses_owner_or_sample_check CHECK (is_sample = true OR user_id IS NOT NULL),
  CONSTRAINT corpses_source_language_check CHECK (source_language IN ('es3', 'es5-jquery', 'legacy-node')),
  CONSTRAINT corpses_status_check CHECK (status IN ('INFECTED', 'IN_SEANCE', 'RESURRECTED', 'FAILED'))
);

CREATE TABLE public.curses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corpse_id uuid NOT NULL REFERENCES public.corpses (id) ON DELETE CASCADE,
  curse_type text NOT NULL,
  severity text NOT NULL,
  line_number INTEGER NOT NULL,
  description text NOT NULL,
  exorcism_strategy text NOT NULL,
  CONSTRAINT curses_severity_check CHECK (severity IN ('HEX', 'BLOOD_CURSE', 'FATAL')),
  CONSTRAINT curses_curse_type_check CHECK (curse_type IN (
    'GLOBAL_POLLUTION', 'VAR_HOISTING', 'IMPLICIT_COERCION',
    'CALLBACK_HELL', 'EVAL_INJECTION', 'PROTOTYPE_POLLUTION'
  ))
);

CREATE TABLE public.seance_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corpse_id uuid NOT NULL REFERENCES public.corpses (id) ON DELETE CASCADE,
  requirements_md text NOT NULL,
  design_md text NOT NULL,
  invariants_json jsonb NOT NULL,
  approved_at timestamptz
);

CREATE TABLE public.reincarnations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corpse_id uuid NOT NULL REFERENCES public.corpses (id) ON DELETE CASCADE,
  target_stack text NOT NULL,
  modern_code text NOT NULL,
  pbt_test_code text NOT NULL,
  pbt_passed BOOLEAN,
  total_runs INTEGER,
  execution_time_ms INTEGER,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX corpses_user_id_idx ON public.corpses (user_id);
CREATE INDEX corpses_code_hash_idx ON public.corpses (code_hash);
CREATE INDEX curses_corpse_id_idx ON public.curses (corpse_id);
CREATE INDEX seance_specs_corpse_id_idx ON public.seance_specs (corpse_id);
CREATE INDEX reincarnations_corpse_id_idx ON public.reincarnations (corpse_id);

-- ---------------------------------------------------------------------------
-- Profile provisioning: one profiles row per new auth.users row
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, github_username, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'user_name',
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Only the trigger may call the function.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Privileges: start from nothing, then grant the minimum each role needs
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE
  public.profiles, public.corpses, public.curses, public.seance_specs, public.reincarnations
  FROM PUBLIC, anon, authenticated;

-- Anonymous visitors can only read. Rows are filtered by the policies below.
-- profiles has no anon policy, so anon reads zero rows from it without an error.
GRANT SELECT ON TABLE
  public.profiles, public.corpses, public.curses, public.seance_specs, public.reincarnations
  TO anon;

-- Profiles are created by the trigger only: no INSERT and no DELETE for API roles.
GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.corpses, public.curses, public.seance_specs, public.reincarnations
  TO authenticated;

-- Keep Flyway's history table out of the Supabase Data API.
REVOKE ALL ON TABLE public.flyway_schema_history FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Owners and the migration role bypass RLS; the service role key is used only in server-side Route Handlers.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corpses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seance_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reincarnations ENABLE ROW LEVEL SECURITY;

-- profiles: a signed-in user reads and updates only their own row.
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = (select auth.uid()));

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (select auth.uid()))
  WITH CHECK (id = (select auth.uid()));

-- corpses: sample rows are public; other rows belong to their owner.
CREATE POLICY corpses_select_samples ON public.corpses
  FOR SELECT TO anon, authenticated
  USING (is_sample = true);

CREATE POLICY corpses_select_own ON public.corpses
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));

CREATE POLICY corpses_insert_own ON public.corpses
  FOR INSERT TO authenticated
  WITH CHECK (is_sample = false AND user_id = (select auth.uid()));

CREATE POLICY corpses_update_own ON public.corpses
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (is_sample = false AND user_id = (select auth.uid()));

CREATE POLICY corpses_delete_own ON public.corpses
  FOR DELETE TO authenticated
  USING (user_id = (select auth.uid()));

-- curses: access follows the parent corpse.
CREATE POLICY curses_select_samples ON public.curses
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = curses.corpse_id AND c.is_sample = true));

CREATE POLICY curses_select_own ON public.curses
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = curses.corpse_id AND c.user_id = (select auth.uid())));

CREATE POLICY curses_insert_own ON public.curses
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = curses.corpse_id AND c.user_id = (select auth.uid())));

CREATE POLICY curses_update_own ON public.curses
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = curses.corpse_id AND c.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = curses.corpse_id AND c.user_id = (select auth.uid())));

CREATE POLICY curses_delete_own ON public.curses
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = curses.corpse_id AND c.user_id = (select auth.uid())));

-- seance_specs: access follows the parent corpse.
CREATE POLICY seance_specs_select_samples ON public.seance_specs
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = seance_specs.corpse_id AND c.is_sample = true));

CREATE POLICY seance_specs_select_own ON public.seance_specs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = seance_specs.corpse_id AND c.user_id = (select auth.uid())));

CREATE POLICY seance_specs_insert_own ON public.seance_specs
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = seance_specs.corpse_id AND c.user_id = (select auth.uid())));

CREATE POLICY seance_specs_update_own ON public.seance_specs
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = seance_specs.corpse_id AND c.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = seance_specs.corpse_id AND c.user_id = (select auth.uid())));

CREATE POLICY seance_specs_delete_own ON public.seance_specs
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = seance_specs.corpse_id AND c.user_id = (select auth.uid())));

-- reincarnations: access follows the parent corpse.
CREATE POLICY reincarnations_select_samples ON public.reincarnations
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = reincarnations.corpse_id AND c.is_sample = true));

CREATE POLICY reincarnations_select_own ON public.reincarnations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = reincarnations.corpse_id AND c.user_id = (select auth.uid())));

CREATE POLICY reincarnations_insert_own ON public.reincarnations
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = reincarnations.corpse_id AND c.user_id = (select auth.uid())));

CREATE POLICY reincarnations_update_own ON public.reincarnations
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = reincarnations.corpse_id AND c.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = reincarnations.corpse_id AND c.user_id = (select auth.uid())));

CREATE POLICY reincarnations_delete_own ON public.reincarnations
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.corpses c WHERE c.id = reincarnations.corpse_id AND c.user_id = (select auth.uid())));
