-- Otomasyonlar (CRM 2. faz): hazir kurallar, her sabah 06:00 (Istanbul)
-- calisir ve gorev acar. Ayni musteri + ayni neden icin bir kez (automation_runs).
-- Eylem simdilik "gorev"; WhatsApp kurulunca "mesaj" eklenebilir.

CREATE TABLE IF NOT EXISTS public.automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('kayip_musteri', 'dogum_gunu', 'gelmedi', 'paket_bitiyor', 'yeni_musteri_takip')),
  enabled boolean NOT NULL DEFAULT true,
  -- { "days": 60 } gibi kurala ozel ayar
  params jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(params) = 'object'),
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, kind)
);
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_rules FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.automation_rules TO authenticated;
DROP POLICY IF EXISTS automation_rules_select ON public.automation_rules;
CREATE POLICY automation_rules_select ON public.automation_rules
  FOR SELECT TO authenticated USING (business_id = public.my_business_id());
DROP POLICY IF EXISTS automation_rules_admin ON public.automation_rules;
CREATE POLICY automation_rules_admin ON public.automation_rules
  FOR ALL TO authenticated
  USING (business_id = public.my_business_id() AND public.my_role() = 'admin')
  WITH CHECK (
    business_id = public.my_business_id() AND public.my_role() = 'admin'
    AND (assignee_id IS NULL OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = assignee_id AND p.business_id = public.my_business_id()))
  );

-- Her kuralin hangi musteri / neden icin calistigi (tekrar gorev acilmasin).
CREATE TABLE IF NOT EXISTS public.automation_runs (
  rule_id uuid NOT NULL REFERENCES public.automation_rules(id) ON DELETE CASCADE,
  run_key text NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, run_key)
);
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_runs FROM anon, authenticated;
GRANT SELECT ON public.automation_runs TO authenticated;
DROP POLICY IF EXISTS automation_runs_select ON public.automation_runs;
CREATE POLICY automation_runs_select ON public.automation_runs
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.automation_rules r WHERE r.id = rule_id AND r.business_id = public.my_business_id()));

-- Kurallari calistirir; p_business null ise tum isletmeler (yalniz zamanlayici).
-- Donus: acilan gorev sayisi.
CREATE OR REPLACE FUNCTION public.run_automations(p_business uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_today date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  v_days int;
  v_total int := 0;
  v_n int;
BEGIN
  FOR r IN
    SELECT * FROM public.automation_rules
    WHERE enabled AND (p_business IS NULL OR business_id = p_business)
  LOOP
    v_n := 0;
    CREATE TEMP TABLE IF NOT EXISTS _auto_cand (customer_id uuid, run_key text, title text) ON COMMIT DROP;
    TRUNCATE _auto_cand;

    IF r.kind = 'kayip_musteri' THEN
      v_days := greatest(14, coalesce((r.params->>'days')::int, 60));
      INSERT INTO _auto_cand
      SELECT l.customer_id, 'kayip:' || l.last_day,
        'Ara: ' || c.full_name || ' (' || (v_today - l.last_day) || ' gündür gelmiyor)'
      FROM (
        SELECT a.customer_id, max((a.scheduled_at AT TIME ZONE 'Europe/Istanbul')::date) AS last_day
        FROM public.appointments a
        WHERE a.business_id = r.business_id AND a.status = 'tamamlandi' AND a.customer_id IS NOT NULL
        GROUP BY a.customer_id
      ) l
      JOIN public.customers c ON c.id = l.customer_id
      WHERE l.last_day <= v_today - v_days
        AND l.last_day > v_today - v_days * 3          -- cok eski kayitlar icin gorev yagmasin
        AND c.full_name <> 'Silinmiş müşteri'
        AND NOT EXISTS (
          SELECT 1 FROM public.appointments f
          WHERE f.customer_id = l.customer_id AND f.scheduled_at > now() AND f.status IN ('bekliyor', 'onaylandi'));

    ELSIF r.kind = 'dogum_gunu' THEN
      v_days := least(30, greatest(0, coalesce((r.params->>'days')::int, 3)));
      INSERT INTO _auto_cand
      SELECT c.id, 'dogum:' || extract(year FROM v_today + v_days),
        'Doğum günü: ' || c.full_name || ' (' || to_char(v_today + v_days, 'DD.MM') || ')'
      FROM public.customers c
      WHERE c.business_id = r.business_id AND c.birthday IS NOT NULL
        AND to_char(c.birthday, 'MM-DD') = to_char(v_today + v_days, 'MM-DD');

    ELSIF r.kind = 'gelmedi' THEN
      INSERT INTO _auto_cand
      SELECT a.customer_id, 'gelmedi:' || a.id,
        'Gelmedi: ' || c.full_name || ' — arayıp yeni randevu ver'
      FROM public.appointments a
      JOIN public.customers c ON c.id = a.customer_id
      WHERE a.business_id = r.business_id AND a.status = 'gelmedi'
        AND a.scheduled_at >= now() - interval '3 days' AND a.scheduled_at <= now();

    ELSIF r.kind = 'paket_bitiyor' THEN
      INSERT INTO _auto_cand
      SELECT sp.customer_id, 'paket:' || sp.id,
        'Paket bitiyor: ' || c.full_name || ' — ' || coalesce(s.name, 'paket') || ' için yenileme teklif et'
      FROM public.service_packages sp
      JOIN public.customers c ON c.id = sp.customer_id
      LEFT JOIN public.services s ON s.id = sp.service_id
      WHERE sp.business_id = r.business_id AND sp.status <> 'tamamlandi'
        AND sp.total_sessions - sp.session_offset - (
          SELECT count(*) FROM public.appointments a WHERE a.package_id = sp.id AND a.status = 'tamamlandi') = 1;

    ELSIF r.kind = 'yeni_musteri_takip' THEN
      v_days := least(60, greatest(1, coalesce((r.params->>'days')::int, 7)));
      INSERT INTO _auto_cand
      SELECT f.customer_id, 'yeni:' || f.customer_id,
        'Yeni müşteri takibi: ' || c.full_name || ' — memnun kaldı mı?'
      FROM (
        SELECT a.customer_id, min((a.scheduled_at AT TIME ZONE 'Europe/Istanbul')::date) AS first_day
        FROM public.appointments a
        WHERE a.business_id = r.business_id AND a.status = 'tamamlandi' AND a.customer_id IS NOT NULL
        GROUP BY a.customer_id
      ) f
      JOIN public.customers c ON c.id = f.customer_id
      WHERE f.first_day = v_today - v_days;
    END IF;

    WITH fresh AS (
      INSERT INTO public.automation_runs (rule_id, run_key, customer_id)
      SELECT r.id, run_key, customer_id FROM _auto_cand
      ON CONFLICT DO NOTHING
      RETURNING run_key, customer_id
    ),
    made AS (
      INSERT INTO public.tasks (business_id, customer_id, title, due_date, assignee_id, created_by)
      SELECT r.business_id, f.customer_id, left(c.title, 200), v_today, r.assignee_id, NULL
      FROM fresh f JOIN _auto_cand c ON c.run_key = f.run_key
      RETURNING id, customer_id
    )
    UPDATE public.automation_runs ar SET task_id = m.id
    FROM made m
    WHERE ar.rule_id = r.id AND ar.customer_id = m.customer_id AND ar.task_id IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    UPDATE public.automation_rules SET last_run_at = now() WHERE id = r.id;
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.run_automations(uuid) FROM PUBLIC, anon, authenticated;

-- Yonetici "Simdi calistir": yalnizca kendi isletmesi.
CREATE OR REPLACE FUNCTION public.run_my_automations()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Sadece yönetici yapabilir' USING ERRCODE = '42501';
  END IF;
  RETURN public.run_automations(public.my_business_id());
END;
$$;
REVOKE ALL ON FUNCTION public.run_my_automations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_my_automations() TO authenticated;

SELECT cron.unschedule('run-automations') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-automations');
-- 03:00 UTC = 06:00 Istanbul
SELECT cron.schedule('run-automations', '0 3 * * *', $$SELECT public.run_automations()$$);
