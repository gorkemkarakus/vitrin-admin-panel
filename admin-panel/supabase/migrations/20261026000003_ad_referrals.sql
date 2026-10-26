-- =============================================================================
-- Reklamdan gelen konusmalar (Meta "WhatsApp'a mesaj gönder" / "Instagram
-- Direct'e mesaj gönder" reklamlari). Musteri reklamdan ilk mesajini atinca
-- Meta reklamin kimligini ve basligini mesajla birlikte gonderir; burada
-- saklanir. Asistan bu kisiye 30 gun icinde randevu acarsa randevu reklama
-- baglanir (appointments.ad_referral_id) ve Reklam ekrani "bu reklam X
-- randevu getirdi" hesaplar. Yazma yalniz webhook'lardan (service_role).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ad_referrals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  channel        text NOT NULL CHECK (channel IN ('whatsapp', 'instagram')),
  -- konusma kimligi: WhatsApp'ta "90532...", Instagram'da "ig:<IGSID>"
  customer_phone text NOT NULL,
  ad_id          text,
  ad_title       text,
  ad_body        text,
  source_url     text,
  -- WhatsApp reklam tiklama kimligi (ctwa_clid)
  click_id       text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_referrals_business_time ON public.ad_referrals (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_referrals_business_phone ON public.ad_referrals (business_id, customer_phone, created_at DESC);

ALTER TABLE public.ad_referrals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_referrals FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.ad_referrals FROM authenticated;

DROP POLICY IF EXISTS "ad_referrals_select" ON public.ad_referrals;
CREATE POLICY "ad_referrals_select"
  ON public.ad_referrals FOR SELECT
  USING (business_id = public.my_business_id() AND (SELECT public.has_perm('mesajlar')));

-- Asistanin reklamdan gelen kisiye actigi randevu hangi reklamdan
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS ad_referral_id uuid REFERENCES public.ad_referrals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_ad_referral ON public.appointments (ad_referral_id) WHERE ad_referral_id IS NOT NULL;

-- Ayni Turk cep numarasinin yazilislari ("90532...", "0532...", "532...",
-- "+90532..."); edge function'lardaki _shared/customerLookup.ts phoneVariants ile ayni.
CREATE OR REPLACE FUNCTION public.phone_variants(p text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p IS NULL THEN ARRAY[]::text[]
    WHEN regexp_replace(p, '\D', '', 'g') ~ '^905\d{9}$'
      THEN ARRAY[p, regexp_replace(p, '\D', '', 'g'), '0' || substr(regexp_replace(p, '\D', '', 'g'), 3),
                 substr(regexp_replace(p, '\D', '', 'g'), 3), '+' || regexp_replace(p, '\D', '', 'g')]
    WHEN regexp_replace(p, '\D', '', 'g') ~ '^05\d{9}$'
      THEN ARRAY[p, '9' || regexp_replace(p, '\D', '', 'g'), regexp_replace(p, '\D', '', 'g'),
                 substr(regexp_replace(p, '\D', '', 'g'), 2), '+9' || regexp_replace(p, '\D', '', 'g')]
    WHEN regexp_replace(p, '\D', '', 'g') ~ '^5\d{9}$'
      THEN ARRAY[p, '90' || regexp_replace(p, '\D', '', 'g'), '0' || regexp_replace(p, '\D', '', 'g'),
                 regexp_replace(p, '\D', '', 'g'), '+90' || regexp_replace(p, '\D', '', 'g')]
    ELSE ARRAY[p]
  END
$$;

-- KVKK silme: sohbet gecmisi WhatsApp yazilisiyla ("90532...") tutuluyor,
-- musteri kaydi "0532..." olabilir; eskiden birebir esitlikle aranip
-- mesajlar silinmeden kaliyordu. Reklam kayitlari da silinir.
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
  v_phones text[];
BEGIN
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Sadece yönetici yapabilir' USING ERRCODE = '42501';
  END IF;
  SELECT business_id, phone, contact_phone INTO v_business, v_phone, v_contact
  FROM public.customers WHERE id = p_customer_id AND business_id = public.my_business_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Müşteri bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  v_phones := public.phone_variants(v_phone) || public.phone_variants(v_contact);

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
    AND (customer_id = p_customer_id OR (phone IS NOT NULL AND phone = ANY (v_phones)));

  UPDATE public.notification_log
  SET phone = NULL,
      message = '[kişisel veri silindi]'
  WHERE customer_id = p_customer_id;

  DELETE FROM public.chatbot_messages
  WHERE business_id = v_business AND customer_phone = ANY (v_phones);

  DELETE FROM public.ad_referrals
  WHERE business_id = v_business AND customer_phone = ANY (v_phones);
END;
$$;
REVOKE ALL ON FUNCTION public.anonymize_customer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anonymize_customer(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
