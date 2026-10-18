-- Sadakat karti: her N ziyarette bir odul ("5 ziyarete 1 fon bizden").
-- Ziyaret = tamamlanan randevusu olan gun (ayni gun iki hizmet tek ziyaret).
-- Damga elle basilmaz; randevu "tamamlandi" olunca kendiliginden sayilir.
-- Odul kullanimi redeem_loyalty() ile: kac ziyaret dustugu satirda saklanir
-- (yonetici sonradan N'i degistirse de gecmis bozulmaz).

CREATE TABLE IF NOT EXISTS public.loyalty_programs (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  visits_required int NOT NULL DEFAULT 5 CHECK (visits_required BETWEEN 2 AND 50),
  reward text NOT NULL CHECK (char_length(btrim(reward)) BETWEEN 1 AND 120),
  counts_from timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.loyalty_programs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loyalty_programs FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.loyalty_programs TO authenticated;
DROP POLICY IF EXISTS loyalty_programs_select ON public.loyalty_programs;
CREATE POLICY loyalty_programs_select ON public.loyalty_programs
  FOR SELECT TO authenticated USING (business_id = public.my_business_id());
DROP POLICY IF EXISTS loyalty_programs_insert ON public.loyalty_programs;
CREATE POLICY loyalty_programs_insert ON public.loyalty_programs
  FOR INSERT TO authenticated
  WITH CHECK (business_id = public.my_business_id() AND public.my_role() = 'admin');
DROP POLICY IF EXISTS loyalty_programs_update ON public.loyalty_programs;
CREATE POLICY loyalty_programs_update ON public.loyalty_programs
  FOR UPDATE TO authenticated
  USING (business_id = public.my_business_id() AND public.my_role() = 'admin')
  WITH CHECK (business_id = public.my_business_id() AND public.my_role() = 'admin');

CREATE OR REPLACE FUNCTION public.loyalty_programs_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS loyalty_programs_stamp ON public.loyalty_programs;
CREATE TRIGGER loyalty_programs_stamp BEFORE UPDATE ON public.loyalty_programs
  FOR EACH ROW EXECUTE FUNCTION public.loyalty_programs_stamp();

CREATE TABLE IF NOT EXISTS public.loyalty_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  visits_used int NOT NULL CHECK (visits_used BETWEEN 2 AND 50),
  reward text NOT NULL,
  redeemed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_redemptions_customer_idx ON public.loyalty_redemptions (customer_id, redeemed_at DESC);

ALTER TABLE public.loyalty_redemptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.loyalty_redemptions FROM anon;
-- Ekleme yalnizca redeem_loyalty() ile; yanlislikla kullanilan odulu yonetici geri alir.
GRANT SELECT, DELETE ON public.loyalty_redemptions TO authenticated;
DROP POLICY IF EXISTS loyalty_redemptions_select ON public.loyalty_redemptions;
CREATE POLICY loyalty_redemptions_select ON public.loyalty_redemptions
  FOR SELECT TO authenticated USING (business_id = public.my_business_id());
DROP POLICY IF EXISTS loyalty_redemptions_delete ON public.loyalty_redemptions;
CREATE POLICY loyalty_redemptions_delete ON public.loyalty_redemptions
  FOR DELETE TO authenticated USING (business_id = public.my_business_id() AND public.my_role() = 'admin');

-- Isletmenin tum musterileri icin kart durumu. Calisan kendi randevularini
-- gorse bile sayim tum randevulardan yapilir (SECURITY DEFINER, isletme filtreli).
CREATE OR REPLACE FUNCTION public.loyalty_cards(p_customer uuid DEFAULT NULL)
RETURNS TABLE (customer_id uuid, full_name text, visits int, used int, available int, progress int, last_visit date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH prog AS (
    SELECT * FROM public.loyalty_programs
    WHERE business_id = public.my_business_id() AND enabled
  ),
  v AS (
    SELECT a.customer_id, count(DISTINCT (a.scheduled_at AT TIME ZONE 'Europe/Istanbul')::date)::int AS visits,
      max((a.scheduled_at AT TIME ZONE 'Europe/Istanbul')::date) AS last_visit
    FROM public.appointments a, prog
    WHERE a.business_id = prog.business_id AND a.status = 'tamamlandi' AND a.customer_id IS NOT NULL
      AND a.scheduled_at >= prog.counts_from
      AND (p_customer IS NULL OR a.customer_id = p_customer)
    GROUP BY a.customer_id
  ),
  u AS (
    SELECT r.customer_id, sum(r.visits_used)::int AS used
    FROM public.loyalty_redemptions r, prog
    WHERE r.business_id = prog.business_id AND (p_customer IS NULL OR r.customer_id = p_customer)
    GROUP BY r.customer_id
  )
  SELECT v.customer_id, c.full_name, v.visits, coalesce(u.used, 0),
    greatest(0, (v.visits - coalesce(u.used, 0)) / prog.visits_required),
    greatest(0, (v.visits - coalesce(u.used, 0)) % prog.visits_required),
    v.last_visit
  FROM v
  CROSS JOIN prog
  JOIN public.customers c ON c.id = v.customer_id AND c.business_id = prog.business_id
  LEFT JOIN u ON u.customer_id = v.customer_id
  WHERE c.full_name <> 'Silinmiş müşteri'
$$;
REVOKE ALL ON FUNCTION public.loyalty_cards(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.loyalty_cards(uuid) TO authenticated;

-- Odulu kullandir: hazir odul yoksa reddeder. Ayni anda iki kez basilirsa
-- musteri satiri kilitlendigi icin ikincisi guncel sayimi gorur.
CREATE OR REPLACE FUNCTION public.redeem_loyalty(p_customer uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prog public.loyalty_programs;
  v_available int;
  v_id uuid;
BEGIN
  SELECT * INTO v_prog FROM public.loyalty_programs WHERE business_id = public.my_business_id() AND enabled;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sadakat kartı kapalı' USING ERRCODE = 'P0001';
  END IF;
  PERFORM 1 FROM public.customers WHERE id = p_customer AND business_id = v_prog.business_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Müşteri bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  SELECT available INTO v_available FROM public.loyalty_cards(p_customer);
  IF coalesce(v_available, 0) < 1 THEN
    RAISE EXCEPTION 'Hazır ödül yok' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.loyalty_redemptions (business_id, customer_id, visits_used, reward, redeemed_by)
  VALUES (v_prog.business_id, p_customer, v_prog.visits_required, v_prog.reward, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_loyalty(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_loyalty(uuid) TO authenticated;

-- KVKK silme: potansiyel musteri kayitlari ve odul gecmisi de gider.
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
