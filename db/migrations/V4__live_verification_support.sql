-- V4: live verification support (usage ledger, quota function, verdict recording).
-- Depends on V1 (profiles, corpses, reincarnations), on V3 (whose reserve_llm_call this quota function mirrors),
-- and on the Supabase auth uid helper function.
-- No object of V1, V2, or V3 is changed. No policy is added to an existing table.

-- ---------------------------------------------------------------------------
-- Verification ledger: one row per reserved verification run
-- ---------------------------------------------------------------------------

CREATE TABLE public.verification_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX verification_usage_events_user_created_idx ON public.verification_usage_events (user_id, created_at);
CREATE INDEX verification_usage_events_created_idx ON public.verification_usage_events (created_at);

-- RLS is enabled and no policy exists, so API roles see nothing. Only reserve_verification_run (SECURITY DEFINER)
-- touches the table. It is separate from llm_usage_events, so the two quotas never count each other's rows.
ALTER TABLE public.verification_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.verification_usage_events FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Quota function: check both limits and record one row in one atomic step
-- ---------------------------------------------------------------------------

-- Same body as public.reserve_llm_call of V3, with three differences only: no route argument and no route check,
-- the table public.verification_usage_events, and its own advisory lock key.
CREATE FUNCTION public.reserve_verification_run(
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
    RAISE EXCEPTION 'reserve_verification_run: no authenticated user' USING ERRCODE = '28000';
  END IF;
  IF p_user_limit IS NULL OR p_user_limit < 1
     OR p_global_limit IS NULL OR p_global_limit < 1
     OR p_user_window IS NULL OR p_user_window <= interval '0'
     OR p_global_window IS NULL OR p_global_window <= interval '0' THEN
    RAISE EXCEPTION 'reserve_verification_run: invalid arguments' USING ERRCODE = '22023';
  END IF;

  -- One transaction-level lock serializes all callers, so both limits are exact under concurrency.
  PERFORM pg_advisory_xact_lock(hashtextextended('lazarus.reserve_verification_run', 0));

  -- Read the clock after the lock is held, so a call that waited counts against the time it actually runs.
  v_now := clock_timestamp();

  -- Rows older than 24 hours are no longer needed. A row exactly 24 hours old is kept.
  DELETE FROM public.verification_usage_events WHERE created_at < v_now - interval '24 hours';

  SELECT count(*) INTO v_user_count
    FROM public.verification_usage_events
    WHERE user_id = v_user AND created_at > v_now - p_user_window;
  SELECT count(*) INTO v_global_count
    FROM public.verification_usage_events
    WHERE created_at > v_now - p_global_window;

  -- The retry-after row is the (count - limit + 1)-th oldest counted row: the one whose departure frees a slot.
  IF v_user_count >= p_user_limit THEN
    SELECT created_at INTO v_oldest
      FROM public.verification_usage_events
      WHERE user_id = v_user AND created_at > v_now - p_user_window
      ORDER BY created_at
      OFFSET (v_user_count - p_user_limit) LIMIT 1;
    v_user_retry := greatest(1, least(86400, ceil(extract(epoch FROM (v_oldest + p_user_window - v_now)))::integer));
  END IF;
  IF v_global_count >= p_global_limit THEN
    SELECT created_at INTO v_oldest
      FROM public.verification_usage_events
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

  INSERT INTO public.verification_usage_events (user_id, created_at) VALUES (v_user, v_now);
  RETURN QUERY SELECT true, 'none'::text, 0;
END;
$$;

-- Supabase grants new functions to the API roles by default, so the revoke names anon explicitly.
REVOKE EXECUTE ON FUNCTION public.reserve_verification_run(integer, interval, integer, interval) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_verification_run(integer, interval, integer, interval) TO authenticated;

-- ---------------------------------------------------------------------------
-- Verdict recording: store one conclusive result and the corpse status in one transaction
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER: Row Level Security decides which rows the caller may update, so a sample, a corpse of another
-- user, and a missing id are never changed. The output columns carry a prefix, so they cannot clash with the
-- column names of public.reincarnations inside the function.
CREATE FUNCTION public.record_verification(
  p_reincarnation_id uuid,
  p_passed boolean,
  p_total_runs integer,
  p_execution_time_ms integer
)
RETURNS TABLE (
  was_updated boolean,
  stored_passed boolean,
  stored_total_runs integer,
  stored_execution_time_ms integer,
  corpse_status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_corpse_id uuid;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'record_verification: no authenticated user' USING ERRCODE = '28000';
  END IF;
  -- A failed run counts the runs up to and including the first failing one, so it can be below 100.
  IF p_reincarnation_id IS NULL OR p_passed IS NULL OR p_total_runs IS NULL OR p_execution_time_ms IS NULL
     OR p_execution_time_ms < 0 OR p_total_runs > 1000
     OR (p_passed AND p_total_runs < 100)
     OR (NOT p_passed AND p_total_runs < 1) THEN
    RAISE EXCEPTION 'record_verification: invalid arguments' USING ERRCODE = '22023';
  END IF;

  -- A stored verdict is final: only a row without one is updated. Two concurrent calls serialize on the row lock,
  -- and the second one finds pbt_passed set and updates nothing.
  UPDATE public.reincarnations r
     SET pbt_passed = p_passed, total_runs = p_total_runs, execution_time_ms = p_execution_time_ms
   WHERE r.id = p_reincarnation_id AND r.pbt_passed IS NULL
  RETURNING r.corpse_id INTO v_corpse_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::boolean, NULL::integer, NULL::integer, NULL::text;
    RETURN;
  END IF;

  -- A terminal status is kept.
  UPDATE public.corpses c
     SET status = CASE WHEN p_passed THEN 'RESURRECTED' ELSE 'FAILED' END
   WHERE c.id = v_corpse_id AND c.status NOT IN ('RESURRECTED', 'FAILED');
  SELECT c.status INTO v_status FROM public.corpses c WHERE c.id = v_corpse_id;

  RETURN QUERY SELECT true, p_passed, p_total_runs, p_execution_time_ms, v_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_verification(uuid, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_verification(uuid, boolean, integer, integer) TO authenticated;

-- Ask PostgREST to reload its schema cache, so the new functions are callable through the Data API at once.
NOTIFY pgrst, 'reload schema';
