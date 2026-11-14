-- V3: LLM pipeline support (usage ledger, quota function, curse replacement, one-result indexes).
-- Depends on V1 (profiles, corpses, curses, seance_specs, reincarnations) and on the Supabase auth uid helper function.
-- No object of V1 or V2 is changed. No policy is added to an existing table.

-- ---------------------------------------------------------------------------
-- Usage ledger: one row per reserved LLM-backed request
-- ---------------------------------------------------------------------------

CREATE TABLE public.llm_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  route text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT llm_usage_events_route_check CHECK (route IN ('seance', 'reincarnate'))
);

CREATE INDEX llm_usage_events_user_created_idx ON public.llm_usage_events (user_id, created_at);
CREATE INDEX llm_usage_events_created_idx ON public.llm_usage_events (created_at);

-- RLS is enabled and no policy exists, so API roles see nothing. Only reserve_llm_call (SECURITY DEFINER) touches the table.
ALTER TABLE public.llm_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.llm_usage_events FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Quota function: check both limits and record one row in one atomic step
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.reserve_llm_call(
  p_route text,
  p_user_limit integer,
  p_user_window interval,
  p_global_limit integer,
  p_global_window interval
)
RETURNS TABLE (allowed boolean, denied_by text, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_now timestamptz;
  v_user_count integer;
  v_global_count integer;
  v_user_retry integer := 0;
  v_global_retry integer := 0;
  v_oldest timestamptz;
BEGIN
  -- Validation comes first, so an invalid call changes nothing.
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'reserve_llm_call: no authenticated user' USING ERRCODE = '28000';
  END IF;
  IF p_route IS NULL OR p_route NOT IN ('seance', 'reincarnate')
     OR p_user_limit IS NULL OR p_user_limit < 1
     OR p_global_limit IS NULL OR p_global_limit < 1
     OR p_user_window IS NULL OR p_user_window <= interval '0'
     OR p_global_window IS NULL OR p_global_window <= interval '0' THEN
    RAISE EXCEPTION 'reserve_llm_call: invalid arguments' USING ERRCODE = '22023';
  END IF;

  -- One transaction-level lock serializes all callers, so both limits are exact under concurrency.
  PERFORM pg_advisory_xact_lock(hashtextextended('lazarus.reserve_llm_call', 0));

  -- Read the clock after the lock is held, so a call that waited counts against the time it actually runs.
  v_now := clock_timestamp();

  -- Rows older than 24 hours are no longer needed. A row exactly 24 hours old is kept.
  DELETE FROM public.llm_usage_events WHERE created_at < v_now - interval '24 hours';

  SELECT count(*) INTO v_user_count
    FROM public.llm_usage_events
    WHERE user_id = v_user AND created_at > v_now - p_user_window;
  SELECT count(*) INTO v_global_count
    FROM public.llm_usage_events
    WHERE created_at > v_now - p_global_window;

  -- The retry-after row is the (count - limit + 1)-th oldest counted row: the one whose departure frees a slot.
  IF v_user_count >= p_user_limit THEN
    SELECT created_at INTO v_oldest
      FROM public.llm_usage_events
      WHERE user_id = v_user AND created_at > v_now - p_user_window
      ORDER BY created_at
      OFFSET (v_user_count - p_user_limit) LIMIT 1;
    v_user_retry := greatest(1, least(86400, ceil(extract(epoch FROM (v_oldest + p_user_window - v_now)))::integer));
  END IF;
  IF v_global_count >= p_global_limit THEN
    SELECT created_at INTO v_oldest
      FROM public.llm_usage_events
      WHERE created_at > v_now - p_global_window
      ORDER BY created_at
      OFFSET (v_global_count - p_global_limit) LIMIT 1;
    v_global_retry := greatest(1, least(86400, ceil(extract(epoch FROM (v_oldest + p_global_window - v_now)))::integer));
  END IF;

  -- A denied call records nothing. The user limit is reported when both limits are reached.
  IF v_user_retry > 0 OR v_global_retry > 0 THEN
    RETURN QUERY SELECT
      false,
      (CASE WHEN v_user_retry > 0 THEN 'user' ELSE 'global' END)::text,
      greatest(v_user_retry, v_global_retry);
    RETURN;
  END IF;

  INSERT INTO public.llm_usage_events (user_id, route, created_at) VALUES (v_user, p_route, v_now);
  RETURN QUERY SELECT true, 'none'::text, 0;
END;
$$;

-- Supabase grants new functions to the API roles by default, so the revoke names anon explicitly.
REVOKE EXECUTE ON FUNCTION public.reserve_llm_call(text, integer, interval, integer, interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_llm_call(text, integer, interval, integer, interval) TO authenticated;

-- ---------------------------------------------------------------------------
-- Curse replacement: delete and insert the curses of one corpse in one transaction
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.replace_corpse_curses(p_corpse_id uuid, p_curses jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_inserted integer;
BEGIN
  IF p_corpse_id IS NULL OR p_curses IS NULL OR jsonb_typeof(p_curses) <> 'array' THEN
    RAISE EXCEPTION 'replace_corpse_curses: invalid arguments' USING ERRCODE = '22023';
  END IF;

  -- Two concurrent replacements of one corpse run one after the other, so the rows never mix.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_corpse_id::text, 0));

  -- Visibility and ownership come from Row Level Security. A sample, a foreign corpse, and a missing id all fail here.
  IF NOT EXISTS (
    SELECT 1 FROM public.corpses c
    WHERE c.id = p_corpse_id AND c.is_sample = false AND c.user_id = (select auth.uid())
  ) THEN
    RAISE EXCEPTION 'replace_corpse_curses: corpse not writable' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.curses WHERE corpse_id = p_corpse_id;

  INSERT INTO public.curses (corpse_id, curse_type, severity, line_number, description, exorcism_strategy)
  SELECT
    p_corpse_id,
    e.value ->> 'curse_type',
    e.value ->> 'severity',
    (e.value ->> 'line_number')::integer,
    e.value ->> 'description',
    e.value ->> 'exorcism_strategy'
  FROM jsonb_array_elements(p_curses) AS e(value);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.replace_corpse_curses(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_corpse_curses(uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- One result per corpse
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX seance_specs_corpse_id_key ON public.seance_specs (corpse_id);
CREATE UNIQUE INDEX reincarnations_corpse_id_key ON public.reincarnations (corpse_id);

-- Ask PostgREST to reload its schema cache, so the new functions are callable through the Data API at once.
NOTIFY pgrst, 'reload schema';
