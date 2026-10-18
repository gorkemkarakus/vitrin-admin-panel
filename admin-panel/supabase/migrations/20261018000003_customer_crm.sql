-- 360° musteri karti (CRM MVP 1): kaynak, dogum gunu, etiketler, isletmenin
-- kendi tanimladigi alanlar, aktivite kaydi ve tek zaman cizelgesi.

-- ---- Musteri alanlari ----
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS birthday date,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  -- { "<customer_field_definitions.id>": deger } — alan adi degisse de deger kaybolmaz.
  ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_source_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_source_check
  CHECK (source IS NULL OR source IN ('instagram', 'tavsiye', 'google', 'yoldan', 'whatsapp', 'online', 'reklam', 'diger'));
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_birthday_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_birthday_check CHECK (birthday IS NULL OR birthday >= DATE '1900-01-01');
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_tags_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_tags_check CHECK (cardinality(tags) <= 20);
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_custom_fields_check;
ALTER TABLE public.customers ADD CONSTRAINT customers_custom_fields_check
  CHECK (jsonb_typeof(custom_fields) = 'object' AND pg_column_size(custom_fields) <= 8192);
CREATE INDEX IF NOT EXISTS customers_tags_idx ON public.customers USING gin (tags);

-- ---- Isletmenin tanimladigi musteri alanlari (alerji, cilt tipi, boya formulu…) ----
CREATE TABLE IF NOT EXISTS public.customer_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  type text NOT NULL CHECK (type IN ('text', 'number', 'date', 'select', 'checkbox')),
  options text[] NOT NULL DEFAULT '{}' CHECK (cardinality(options) <= 30),
  -- Ozel nitelikli kisisel veri (saglik vb.): KVKK md. 6, acik riza gerekir.
  sensitive boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, label)
);
ALTER TABLE public.customer_field_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_field_definitions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_field_definitions TO authenticated;
DROP POLICY IF EXISTS customer_field_definitions_select ON public.customer_field_definitions;
CREATE POLICY customer_field_definitions_select ON public.customer_field_definitions
  FOR SELECT TO authenticated USING (business_id = public.my_business_id());
DROP POLICY IF EXISTS customer_field_definitions_admin ON public.customer_field_definitions;
CREATE POLICY customer_field_definitions_admin ON public.customer_field_definitions
  FOR ALL TO authenticated
  USING (business_id = public.my_business_id() AND public.my_role() = 'admin')
  WITH CHECK (business_id = public.my_business_id() AND public.my_role() = 'admin');

-- Isletme basina en fazla 40 alan.
CREATE OR REPLACE FUNCTION public.enforce_customer_field_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.customer_field_definitions WHERE business_id = NEW.business_id) >= 40 THEN
    RAISE EXCEPTION 'En fazla 40 müşteri alanı tanımlanabilir.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS customer_field_definitions_limit ON public.customer_field_definitions;
CREATE TRIGGER customer_field_definitions_limit BEFORE INSERT ON public.customer_field_definitions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_field_limit();

-- ---- Aktivite kaydi: not, arama, mesaj, ziyaret, sikayet ----
CREATE TABLE IF NOT EXISTS public.customer_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('not', 'arama', 'mesaj', 'ziyaret', 'sikayet')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_activities_customer_idx ON public.customer_activities (customer_id, created_at DESC);
ALTER TABLE public.customer_activities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_activities FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_activities TO authenticated;
DROP POLICY IF EXISTS customer_activities_select ON public.customer_activities;
CREATE POLICY customer_activities_select ON public.customer_activities
  FOR SELECT TO authenticated USING (business_id = public.my_business_id());
DROP POLICY IF EXISTS customer_activities_insert ON public.customer_activities;
CREATE POLICY customer_activities_insert ON public.customer_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.my_business_id()
    AND author_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.business_id = public.my_business_id())
  );
-- Yazan kisi ya da yonetici duzenler/siler.
DROP POLICY IF EXISTS customer_activities_update ON public.customer_activities;
CREATE POLICY customer_activities_update ON public.customer_activities
  FOR UPDATE TO authenticated
  USING (business_id = public.my_business_id() AND (author_id = auth.uid() OR public.my_role() = 'admin'))
  WITH CHECK (business_id = public.my_business_id());
DROP POLICY IF EXISTS customer_activities_delete ON public.customer_activities;
CREATE POLICY customer_activities_delete ON public.customer_activities
  FOR DELETE TO authenticated
  USING (business_id = public.my_business_id() AND (author_id = auth.uid() OR public.my_role() = 'admin'));

-- ---- Zaman cizelgesi: musterinin tum gecmisi tek listede ----
-- SECURITY INVOKER: cagiranin RLS kurallari gecerli (ör. Mesajlar yetkisi
-- olmayan calisan WhatsApp konusmalarini, yonetici olmayan bildirim kaydini
-- gormez). Telefonlar farkli bicimlerde kayitli (5xx, 05xx, 905xx): son 10
-- haneyle eslesir.
CREATE OR REPLACE FUNCTION public.customer_timeline(p_customer uuid, p_limit int DEFAULT 300)
RETURNS TABLE (
  at timestamptz,
  kind text,
  title text,
  detail text,
  amount numeric,
  status text,
  ref_id text,
  actor text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH c AS (
    SELECT id, created_at,
      right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) AS p10,
      right(regexp_replace(coalesce(contact_phone, ''), '\D', '', 'g'), 10) AS c10
    FROM public.customers WHERE id = p_customer
  )
  SELECT * FROM (
    SELECT c.created_at, 'kayit'::text, 'Müşteri kaydı oluşturuldu'::text, NULL::text, NULL::numeric, NULL::text, c.id::text, NULL::text
    FROM c
    UNION ALL
    SELECT a.scheduled_at, 'randevu', coalesce(s.name, 'Randevu'), pr.full_name,
      coalesce(a.price_override, s.price)::numeric, a.status::text, a.id::text, NULL
    FROM public.appointments a
    LEFT JOIN public.services s ON s.id = a.service_id
    LEFT JOIN public.profiles pr ON pr.id = a.employee_id
    WHERE a.customer_id = p_customer
    UNION ALL
    SELECT p.paid_at, CASE WHEN p.voided_at IS NULL THEN 'odeme' ELSE 'odeme_iptal' END, 'Ödeme', p.note,
      p.amount::numeric, p.method::text, p.id::text, pr.full_name
    FROM public.payments p
    LEFT JOIN public.profiles pr ON pr.id = p.created_by_user_id
    WHERE p.customer_id = p_customer
    UNION ALL
    SELECT sp.created_at, 'paket', coalesce(s.name, 'Paket'), sp.total_sessions || ' seans', NULL, sp.status::text, sp.id::text, NULL
    FROM public.service_packages sp
    LEFT JOIN public.services s ON s.id = sp.service_id
    WHERE sp.customer_id = p_customer
    UNION ALL
    SELECT ca.created_at, ca.kind, NULL, ca.body, NULL, NULL, ca.id::text, pr.full_name
    FROM public.customer_activities ca
    LEFT JOIN public.profiles pr ON pr.id = ca.author_id
    WHERE ca.customer_id = p_customer
    UNION ALL
    SELECT e.created_at, 'izin',
      CASE WHEN e.granted THEN 'Kampanya izni verildi' ELSE 'Kampanya izni geri alındı' END,
      e.source, NULL, NULL, e.id::text, pr.full_name
    FROM public.customer_consent_events e
    LEFT JOIN public.profiles pr ON pr.id = e.actor_id
    WHERE e.customer_id = p_customer
    UNION ALL
    SELECT n.created_at, 'bildirim',
      CASE n.kind WHEN 'reminder' THEN 'Randevu hatırlatması gönderildi'
                  WHEN 'bulk_campaign' THEN 'Kampanya mesajı gönderildi'
                  ELSE 'Mesaj gönderildi' END,
      n.message, NULL, n.kind::text, n.id::text, NULL
    FROM public.notification_log n
    WHERE n.customer_id = p_customer
    UNION ALL
    -- Bot konusmalari gun gun ozetlenir.
    SELECT max(m.created_at), 'whatsapp', 'WhatsApp konuşması', count(*) || ' mesaj', NULL, NULL, NULL, NULL
    FROM public.chatbot_messages m, c
    WHERE c.p10 <> ''
      AND right(regexp_replace(m.customer_phone, '\D', '', 'g'), 10) IN (c.p10, nullif(c.c10, ''))
    GROUP BY (m.created_at AT TIME ZONE 'Europe/Istanbul')::date
  ) t (at, kind, title, detail, amount, status, ref_id, actor)
  ORDER BY at DESC NULLS LAST
  LIMIT least(greatest(p_limit, 1), 1000)
$$;
REVOKE ALL ON FUNCTION public.customer_timeline(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_timeline(uuid, int) TO authenticated;

-- ---- KVKK: "kisisel verilerini sil" yeni alanlari da temizler ----
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
