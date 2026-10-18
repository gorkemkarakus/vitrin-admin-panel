-- Gorevler ve "bugun yapilacaklar" (CRM MVP 2): "Ayse Hanim'i 3 gun sonra ara"
-- gibi takipler. Musteriye bagli ya da genel; bir calisana atanabilir.

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  note text CHECK (note IS NULL OR char_length(note) <= 1000),
  -- Gun (zorunlu) + istege bagli saat; saat yoksa gun icinde herhangi bir an.
  due_date date NOT NULL,
  due_time time,
  -- null = atanmamis (ekipten herhangi biri yapabilir)
  assignee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  status text NOT NULL DEFAULT 'acik' CHECK (status IN ('acik', 'tamamlandi', 'iptal')),
  completed_at timestamptz,
  completed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'tamamlandi') = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS tasks_open_idx ON public.tasks (business_id, status, due_date);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON public.tasks (assignee_id, status, due_date);
CREATE INDEX IF NOT EXISTS tasks_customer_idx ON public.tasks (customer_id);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tasks FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;

DROP POLICY IF EXISTS tasks_select ON public.tasks;
CREATE POLICY tasks_select ON public.tasks
  FOR SELECT TO authenticated USING (business_id = public.my_business_id());

DROP POLICY IF EXISTS tasks_insert ON public.tasks;
CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.my_business_id()
    AND created_by = auth.uid()
    AND (customer_id IS NULL OR EXISTS (
      SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.business_id = public.my_business_id()))
    AND (assignee_id IS NULL OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = assignee_id AND p.business_id = public.my_business_id()))
  );

-- Tamamlama/duzenleme: atanan kisi, olusturan, atanmamissa herkes, yonetici her zaman.
DROP POLICY IF EXISTS tasks_update ON public.tasks;
CREATE POLICY tasks_update ON public.tasks
  FOR UPDATE TO authenticated
  USING (
    business_id = public.my_business_id()
    AND (assignee_id IS NULL OR assignee_id = auth.uid() OR created_by = auth.uid() OR public.my_role() = 'admin')
  )
  WITH CHECK (
    business_id = public.my_business_id()
    AND (assignee_id IS NULL OR EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = assignee_id AND p.business_id = public.my_business_id()))
  );

DROP POLICY IF EXISTS tasks_delete ON public.tasks;
CREATE POLICY tasks_delete ON public.tasks
  FOR DELETE TO authenticated
  USING (business_id = public.my_business_id() AND (created_by = auth.uid() OR public.my_role() = 'admin'));

-- Tamamlayan / zaman damgalari sunucuda: istemci ne gonderirse gondersin tutarli kalir.
CREATE OR REPLACE FUNCTION public.tasks_stamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status = 'tamamlandi' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'tamamlandi') THEN
    NEW.completed_at := now();
    NEW.completed_by := auth.uid();
  ELSIF NEW.status <> 'tamamlandi' THEN
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tasks_stamp ON public.tasks;
CREATE TRIGGER tasks_stamp BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_stamp();

-- Zaman cizelgesine gorevler: tamamlananlar tamamlandiklari anda, acik
-- olanlar son tarihlerinde gorunur.
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
    SELECT coalesce(t.completed_at, (t.due_date + coalesce(t.due_time, time '09:00')) AT TIME ZONE 'Europe/Istanbul'),
      'gorev', t.title, t.note, NULL, t.status, t.id::text, coalesce(done.full_name, asg.full_name)
    FROM public.tasks t
    LEFT JOIN public.profiles asg ON asg.id = t.assignee_id
    LEFT JOIN public.profiles done ON done.id = t.completed_by
    WHERE t.customer_id = p_customer AND t.status <> 'iptal'
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
