-- Memnuniyet anketi: tamamlanan randevudan sonra musteriye tek kullanimlik
-- bir baglanti gider (simdilik ekipten biri WhatsApp ile paylasir). Musteri
-- 1-5 puan + istege bagli yorum birakir:
--   * dusuk puan -> isletmeye "ara, gonlunu al" gorevi acilir
--   * 4-5 puan   -> Google yorum baglantisi gosterilir (ayarlandiysa)
-- Giris yapmamis musteri yalnizca survey_info / submit_survey ile erisir;
-- jeton 64 hex (tahmin edilemez), 30 gun gecerli, tek yanit.

CREATE TABLE IF NOT EXISTS public.survey_settings (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  google_review_url text CHECK (
    google_review_url IS NULL OR (google_review_url ~ '^https://' AND char_length(google_review_url) <= 500)),
  low_rating int NOT NULL DEFAULT 3 CHECK (low_rating BETWEEN 1 AND 4),
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.survey_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.survey_settings FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.survey_settings TO authenticated;
DROP POLICY IF EXISTS survey_settings_select ON public.survey_settings;
CREATE POLICY survey_settings_select ON public.survey_settings
  FOR SELECT TO authenticated USING (business_id = public.my_business_id());
DROP POLICY IF EXISTS survey_settings_insert ON public.survey_settings;
CREATE POLICY survey_settings_insert ON public.survey_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.my_business_id() AND public.my_role() = 'admin'
    AND (assignee_id IS NULL OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = assignee_id AND p.business_id = public.my_business_id())));
DROP POLICY IF EXISTS survey_settings_update ON public.survey_settings;
CREATE POLICY survey_settings_update ON public.survey_settings
  FOR UPDATE TO authenticated
  USING (business_id = public.my_business_id() AND public.my_role() = 'admin')
  WITH CHECK (
    business_id = public.my_business_id() AND public.my_role() = 'admin'
    AND (assignee_id IS NULL OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = assignee_id AND p.business_id = public.my_business_id())));

CREATE TABLE IF NOT EXISTS public.surveys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE
    DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  rating int CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 1000),
  responded_at timestamptz,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  CHECK ((rating IS NULL) = (responded_at IS NULL))
);
CREATE INDEX IF NOT EXISTS surveys_business_idx ON public.surveys (business_id, responded_at DESC);
CREATE INDEX IF NOT EXISTS surveys_customer_idx ON public.surveys (customer_id);

ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.surveys FROM anon;
-- Ekleme create_survey(), yanit submit_survey() ile; dogrudan yazma yok.
GRANT SELECT ON public.surveys TO authenticated;
DROP POLICY IF EXISTS surveys_select ON public.surveys;
CREATE POLICY surveys_select ON public.surveys
  FOR SELECT TO authenticated USING (business_id = public.my_business_id());

-- Ekipten biri tamamlanan randevu icin baglanti olusturur (varsa ayni jeton doner).
CREATE OR REPLACE FUNCTION public.create_survey(p_appointment uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt public.appointments;
  v_token text;
BEGIN
  SELECT * INTO v_appt FROM public.appointments
  WHERE id = p_appointment AND business_id = public.my_business_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Randevu bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  IF v_appt.status <> 'tamamlandi' OR v_appt.customer_id IS NULL THEN
    RAISE EXCEPTION 'Anket yalnızca tamamlanan randevu için' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.surveys (business_id, appointment_id, customer_id, created_by)
  VALUES (v_appt.business_id, v_appt.id, v_appt.customer_id, auth.uid())
  ON CONFLICT (appointment_id) DO NOTHING;
  SELECT token INTO v_token FROM public.surveys WHERE appointment_id = v_appt.id;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.create_survey(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_survey(uuid) TO authenticated;

-- Anket sayfasi icin ozet (musteri gorur). Kisisel veri olarak yalnizca ilk ad.
CREATE OR REPLACE FUNCTION public.survey_info(p_token text)
RETURNS TABLE (business_name text, first_name text, service_name text, visit_date date, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.name,
    nullif(split_part(btrim(c.full_name), ' ', 1), ''),
    sv.name,
    (a.scheduled_at AT TIME ZONE 'Europe/Istanbul')::date,
    CASE WHEN s.responded_at IS NOT NULL THEN 'yanitlandi'
         WHEN s.expires_at < now() THEN 'suresi_doldu'
         ELSE 'acik' END
  FROM public.surveys s
  JOIN public.businesses b ON b.id = s.business_id
  JOIN public.appointments a ON a.id = s.appointment_id
  JOIN public.customers c ON c.id = s.customer_id
  LEFT JOIN public.services sv ON sv.id = a.service_id
  WHERE p_token ~ '^[0-9a-f]{64}$' AND s.token = p_token AND c.full_name <> 'Silinmiş müşteri'
$$;
REVOKE ALL ON FUNCTION public.survey_info(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.survey_info(text) TO anon, authenticated;

-- Yanit: tek sefer. Dusuk puanda gorev acar; yuksek puanda Google baglantisini doner.
CREATE OR REPLACE FUNCTION public.submit_survey(p_token text, p_rating int, p_comment text DEFAULT NULL)
RETURNS TABLE (ok boolean, google_review_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s public.surveys;
  v_set public.survey_settings;
  v_name text;
  v_comment text := nullif(left(btrim(coalesce(p_comment, '')), 1000), '');
  v_task uuid;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' OR p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN
    RETURN QUERY SELECT false, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO v_s FROM public.surveys WHERE token = p_token FOR UPDATE;
  IF NOT FOUND OR v_s.responded_at IS NOT NULL OR v_s.expires_at < now() THEN
    RETURN QUERY SELECT false, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO v_set FROM public.survey_settings WHERE business_id = v_s.business_id;
  SELECT full_name INTO v_name FROM public.customers WHERE id = v_s.customer_id;

  IF p_rating <= coalesce(v_set.low_rating, 3) THEN
    INSERT INTO public.tasks (business_id, customer_id, title, note, due_date, assignee_id, created_by)
    VALUES (v_s.business_id, v_s.customer_id,
      left('Memnun kalmadı (' || p_rating || '/5): ' || coalesce(v_name, 'müşteri') || ' — arayıp gönlünü al', 200),
      v_comment, (now() AT TIME ZONE 'Europe/Istanbul')::date, v_set.assignee_id, NULL)
    RETURNING id INTO v_task;
  END IF;

  UPDATE public.surveys
  SET rating = p_rating, comment = v_comment, responded_at = now(), task_id = v_task
  WHERE id = v_s.id;

  RETURN QUERY SELECT true, CASE WHEN p_rating >= 4 THEN v_set.google_review_url END;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_survey(text, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_survey(text, int, text) TO anon, authenticated;

-- KVKK silme: anket yorumlari da gider.
CREATE OR REPLACE FUNCTION public.anonymize_customer(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business uuid;
  v_phone text;
  v_contact text;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Sadece yönetici yapabilir' USING ERRCODE = '42501';
  END IF;
  SELECT business_id, phone, contact_phone INTO v_business, v_phone, v_contact
  FROM public.customers WHERE id = p_customer_id AND business_id = public.my_business_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Müşteri bulunamadı' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.customers
  SET full_name = 'Silinmiş müşteri',
      phone = NULL,
      contact_phone = NULL,
      email = NULL,
      notes = NULL,
      bot_paused_until = NULL,
      marketing_consent = false,
      birthday = NULL,
      source = NULL,
      tags = '{}',
      custom_fields = '{}'::jsonb
  WHERE id = p_customer_id;

  DELETE FROM public.customer_group_members WHERE customer_id = p_customer_id;
  DELETE FROM public.customer_activities WHERE customer_id = p_customer_id;
  DELETE FROM public.tasks WHERE customer_id = p_customer_id;
  DELETE FROM public.customer_files WHERE customer_id = p_customer_id;
  DELETE FROM public.loyalty_redemptions WHERE customer_id = p_customer_id;
  DELETE FROM public.surveys WHERE customer_id = p_customer_id;
  DELETE FROM public.leads
  WHERE business_id = v_business
    AND (customer_id = p_customer_id OR (phone IS NOT NULL AND phone IN (v_phone, v_contact)));

  UPDATE public.notification_log
  SET phone = NULL,
      message = '[kişisel veri silindi]'
  WHERE customer_id = p_customer_id;

  DELETE FROM public.chatbot_messages
  WHERE business_id = v_business AND customer_phone IN (v_phone, v_contact);
END;
$$;
REVOKE ALL ON FUNCTION public.anonymize_customer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anonymize_customer(uuid) TO authenticated;
