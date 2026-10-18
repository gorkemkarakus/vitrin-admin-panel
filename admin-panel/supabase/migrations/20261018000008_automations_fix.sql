-- run_automations: acilan gorevler calisma kaydina baglanir ve sayilir (ilk
-- surumde ayni ifade icindeki eklemeler gorunmedigi icin 0 donuyordu).
CREATE OR REPLACE FUNCTION public.run_automations(p_business uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  c record;
  v_task uuid;
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

    -- Yeni (daha once calismamis) adaylar; ayni ifade icinde eklenen satirlar
    -- gorunmedigi icin gorevler ayri adimda acilir.
    CREATE TEMP TABLE IF NOT EXISTS _auto_new (run_key text, customer_id uuid) ON COMMIT DROP;
    TRUNCATE _auto_new;
    WITH fresh AS (
      INSERT INTO public.automation_runs (rule_id, run_key, customer_id)
      SELECT r.id, run_key, customer_id FROM _auto_cand
      ON CONFLICT DO NOTHING
      RETURNING run_key, customer_id
    )
    INSERT INTO _auto_new SELECT run_key, customer_id FROM fresh;

    FOR c IN SELECT n.run_key, n.customer_id, a.title FROM _auto_new n JOIN _auto_cand a ON a.run_key = n.run_key LOOP
      INSERT INTO public.tasks (business_id, customer_id, title, due_date, assignee_id, created_by)
      VALUES (r.business_id, c.customer_id, left(c.title, 200), v_today, r.assignee_id, NULL)
      RETURNING id INTO v_task;
      UPDATE public.automation_runs SET task_id = v_task WHERE rule_id = r.id AND run_key = c.run_key;
      v_n := v_n + 1;
    END LOOP;

    UPDATE public.automation_rules SET last_run_at = now() WHERE id = r.id;
    v_total := v_total + v_n;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.run_automations(uuid) FROM PUBLIC, anon, authenticated;
