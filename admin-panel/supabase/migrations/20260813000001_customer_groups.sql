-- Toplu Mesaj: musteri gruplari + kampanya mesaj sablonlari.
-- Sabit/akilli gruplar (hizmet bazli, iptal edenler, uzun suredir gelmeyenler
-- vb.) DB'de HIC saklanmiyor — CustomersPage.tsx'teki VIP/Risk/Yeni/Sadik
-- segmentleriyle AYNI desen, tamamen client-side canli hesaplaniyor. Bu
-- tablolar SADECE kullanicinin kendi olusturdugu OZEL gruplar + yeniden
-- kullanilabilir mesaj sablonlari icin.

CREATE TABLE IF NOT EXISTS public.customer_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_groups_business_id ON public.customer_groups (business_id);

CREATE TRIGGER trg_customer_groups_updated_at
  BEFORE UPDATE ON public.customer_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.customer_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_groups_admin_all"
  ON public.customer_groups FOR ALL
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  )
  WITH CHECK (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  );

-- business_id burada denormalize edilerek tutuluyor (customer_groups'a JOIN
-- gerekmeden dogrudan RLS kontrolu icin) — payments/appointments gibi diger
-- cok-taraf tablolarindaki ayni desen.
CREATE TABLE IF NOT EXISTS public.customer_group_members (
  group_id    uuid NOT NULL REFERENCES public.customer_groups(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, customer_id)
);

CREATE INDEX idx_customer_group_members_business_id ON public.customer_group_members (business_id);

ALTER TABLE public.customer_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_group_members_admin_all"
  ON public.customer_group_members FOR ALL
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  )
  WITH CHECK (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  );

CREATE TABLE IF NOT EXISTS public.campaign_message_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  title       text NOT NULL,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_message_templates_business_id ON public.campaign_message_templates (business_id);

CREATE TRIGGER trg_campaign_message_templates_updated_at
  BEFORE UPDATE ON public.campaign_message_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.campaign_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_message_templates_admin_all"
  ON public.campaign_message_templates FOR ALL
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  )
  WITH CHECK (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  );

-- notification_log'a yeni bir 'bulk_campaign' kind'i ekleniyor (toplu mesaj
-- gonderimleri de ayni tek-nokta gecmis tablosuna dusuyor) + admin'in kendi
-- isletmesinin gecmisini gorebilmesi icin SELECT policy'si (bu tablo
-- kurulduğunda bilincli olarak client'a hic acilmamisti — su ana kadar
-- gosterilecek bir ekran yoktu; artik Kampanya Mesajlari icin gerekli).
-- Constraint adi varsayilan Postgres adlandirmasiyla (notification_log_kind_check)
-- olmasi beklenir ama garantiye almak icin pg_constraint'ten dinamik bulunuyor.
DO $$
DECLARE
  existing_constraint text;
BEGIN
  SELECT con.conname INTO existing_constraint
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE rel.relname = 'notification_log' AND nsp.nspname = 'public'
    AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%kind%';
  IF existing_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.notification_log DROP CONSTRAINT %I', existing_constraint);
  END IF;
END $$;

ALTER TABLE public.notification_log ADD CONSTRAINT notification_log_kind_check
  CHECK (kind IN ('confirmation', 'reminder', 'bulk_campaign'));

CREATE POLICY "notification_log_select_admin"
  ON public.notification_log FOR SELECT
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  );
