-- Potansiyel musteri hunisi (CRM 2. faz): arayan, yazan, botla konusup randevu
-- almayan kisiler. Asamalar: yeni -> iletisim -> teklif -> kazanildi / kaybedildi.
-- Kaybedildi icin neden zorunlu (sonradan analiz).

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 120),
  phone text CHECK (phone IS NULL OR char_length(phone) <= 32),
  source text NOT NULL DEFAULT 'diger'
    CHECK (source IN ('whatsapp', 'instagram', 'telefon', 'tavsiye', 'online', 'reklam', 'yoldan', 'diger')),
  interest text CHECK (interest IS NULL OR char_length(interest) <= 120),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  stage text NOT NULL DEFAULT 'yeni' CHECK (stage IN ('yeni', 'iletisim', 'teklif', 'kazanildi', 'kaybedildi')),
  lost_reason text CHECK (lost_reason IS NULL OR char_length(lost_reason) <= 120),
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (stage <> 'kaybedildi' OR lost_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS leads_stage_idx ON public.leads (business_id, stage, stage_changed_at DESC);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON public.leads (business_id, phone);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leads FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
DROP POLICY IF EXISTS leads_select ON public.leads;
CREATE POLICY leads_select ON public.leads FOR SELECT TO authenticated USING (business_id = public.my_business_id());
DROP POLICY IF EXISTS leads_insert ON public.leads;
CREATE POLICY leads_insert ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.my_business_id() AND created_by = auth.uid()
    AND (assignee_id IS NULL OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = assignee_id AND p.business_id = public.my_business_id()))
    AND (customer_id IS NULL OR EXISTS (
      SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.business_id = public.my_business_id()))
  );
DROP POLICY IF EXISTS leads_update ON public.leads;
CREATE POLICY leads_update ON public.leads
  FOR UPDATE TO authenticated
  USING (business_id = public.my_business_id())
  WITH CHECK (
    business_id = public.my_business_id()
    AND (assignee_id IS NULL OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = assignee_id AND p.business_id = public.my_business_id()))
    AND (customer_id IS NULL OR EXISTS (
      SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.business_id = public.my_business_id()))
  );
DROP POLICY IF EXISTS leads_delete ON public.leads;
CREATE POLICY leads_delete ON public.leads
  FOR DELETE TO authenticated
  USING (business_id = public.my_business_id() AND (created_by = auth.uid() OR public.my_role() = 'admin'));

CREATE OR REPLACE FUNCTION public.leads_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_changed_at := now();
  END IF;
  IF NEW.stage <> 'kaybedildi' THEN
    NEW.lost_reason := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS leads_stamp ON public.leads;
CREATE TRIGGER leads_stamp BEFORE INSERT OR UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.leads_stamp();

-- Bot onerileri: son 30 gunde botla konusan, ileri/gecmis randevusu olmayan ve
-- hunide olmayan numaralar. SECURITY INVOKER: Mesajlar yetkisi olmayan bos gorur.
CREATE OR REPLACE FUNCTION public.lead_suggestions()
RETURNS TABLE (phone text, last_message_at timestamptz, message_count bigint, customer_name text, last_text text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH conv AS (
    SELECT m.customer_phone AS phone,
      right(regexp_replace(m.customer_phone, '\D', '', 'g'), 10) AS p10,
      max(m.created_at) AS last_at,
      count(*) AS n,
      (array_agg(m.content ORDER BY m.created_at DESC) FILTER (WHERE m.role = 'user'))[1] AS last_text
    FROM public.chatbot_messages m
    WHERE m.created_at > now() - interval '30 days'
    GROUP BY m.customer_phone
  )
  SELECT conv.phone, conv.last_at, conv.n, c.full_name, left(conv.last_text, 160)
  FROM conv
  LEFT JOIN public.customers c
    ON right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = conv.p10
  WHERE conv.p10 <> ''
    AND NOT EXISTS (SELECT 1 FROM public.appointments a WHERE c.id IS NOT NULL AND a.customer_id = c.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.leads l WHERE right(regexp_replace(coalesce(l.phone, ''), '\D', '', 'g'), 10) = conv.p10)
  ORDER BY conv.last_at DESC
  LIMIT 30
$$;
REVOKE ALL ON FUNCTION public.lead_suggestions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_suggestions() TO authenticated;
