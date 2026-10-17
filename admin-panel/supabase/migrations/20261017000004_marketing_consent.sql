-- Ticari elektronik ileti izni (6563 sayili Kanun / IYS). Toplu kampanya
-- mesajlari yalnizca izni olan ve ret bildirmemis musterilere gider.
-- Mevcut musteriler izinsiz (false) baslar: izin kaniti olmayan kisiye
-- kampanya gonderilmemeli (bkz. RELEASE_AUDIT.md "Karar bekleyenler").

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS marketing_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_consent_source text
    CHECK (marketing_consent_source IN ('manual', 'online_booking', 'whatsapp', 'import')),
  ADD COLUMN IF NOT EXISTS marketing_opt_out_at timestamptz;

-- customers sutun bazli yetkili (bkz. 20260725000008): yeni sutunlar acikca acilir.
-- marketing_consent_at / marketing_opt_out_at yalnizca tetikleyiciyle yazilir.
GRANT SELECT (marketing_consent, marketing_consent_at, marketing_consent_source, marketing_opt_out_at)
  ON public.customers TO authenticated;
GRANT INSERT (marketing_consent, marketing_consent_source), UPDATE (marketing_consent, marketing_consent_source)
  ON public.customers TO authenticated;

-- Izin/ret kaniti: her degisiklik kim, ne zaman, hangi kanaldan kaydiyla.
CREATE TABLE IF NOT EXISTS public.customer_consent_events (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  granted boolean NOT NULL,
  source text NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customer_consent_events_customer ON public.customer_consent_events (customer_id, created_at);
ALTER TABLE public.customer_consent_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_consent_events FROM anon, authenticated;
GRANT SELECT ON public.customer_consent_events TO authenticated;
DROP POLICY IF EXISTS customer_consent_events_select ON public.customer_consent_events;
CREATE POLICY customer_consent_events_select ON public.customer_consent_events
  FOR SELECT TO authenticated USING (business_id = public.my_business_id());

-- Tarihleri sunucu atar (istemci saatine guvenilmez) ve degisikligi kaydeder.
CREATE OR REPLACE FUNCTION public.customers_consent_stamp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.marketing_consent THEN
      NEW.marketing_consent_at := now();
      NEW.marketing_consent_source := coalesce(NEW.marketing_consent_source, 'manual');
    ELSE
      NEW.marketing_consent_at := NULL;
    END IF;
    NEW.marketing_opt_out_at := NULL;
  ELSIF NEW.marketing_consent IS DISTINCT FROM OLD.marketing_consent THEN
    IF NEW.marketing_consent THEN
      NEW.marketing_consent_at := now();
      NEW.marketing_consent_source := coalesce(NEW.marketing_consent_source, 'manual');
      NEW.marketing_opt_out_at := NULL;
    ELSE
      NEW.marketing_opt_out_at := now();
    END IF;
  ELSE
    -- Izin degismediyse damgalar istemciden degistirilemez.
    NEW.marketing_consent_at := OLD.marketing_consent_at;
    NEW.marketing_opt_out_at := OLD.marketing_opt_out_at;
    NEW.marketing_consent_source := OLD.marketing_consent_source;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.customers_consent_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.marketing_consent)
     OR (TG_OP = 'UPDATE' AND NEW.marketing_consent IS DISTINCT FROM OLD.marketing_consent) THEN
    INSERT INTO public.customer_consent_events (business_id, customer_id, granted, source, actor_id)
    VALUES (
      NEW.business_id,
      NEW.id,
      NEW.marketing_consent,
      CASE WHEN NEW.marketing_consent THEN coalesce(NEW.marketing_consent_source, 'manual')
           ELSE coalesce(current_setting('app.consent_source', true), 'manual') END,
      auth.uid()
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS customers_consent_stamp ON public.customers;
CREATE TRIGGER customers_consent_stamp BEFORE INSERT OR UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.customers_consent_stamp();
DROP TRIGGER IF EXISTS customers_consent_log ON public.customers;
CREATE TRIGGER customers_consent_log AFTER INSERT OR UPDATE OF marketing_consent ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.customers_consent_log();

-- WhatsApp'tan "RET" yazan musteri: isletme + telefon ile izni kapatir.
-- Yalnizca edge function (service role) cagirir. Kac musteri etkilendi doner.
CREATE OR REPLACE FUNCTION public.opt_out_customer_by_phone(p_business uuid, p_phone text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
  -- Son 10 hane: 0532..., +90 532..., 90532... ayni numara sayilir.
  v_tail text := right(regexp_replace(p_phone, '\D', '', 'g'), 10);
BEGIN
  IF length(v_tail) < 10 THEN
    RETURN 0;
  END IF;
  PERFORM set_config('app.consent_source', 'whatsapp', true);
  UPDATE public.customers
  SET marketing_consent = false
  WHERE business_id = p_business
    AND marketing_consent
    AND (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_tail
         OR right(regexp_replace(coalesce(contact_phone, ''), '\D', '', 'g'), 10) = v_tail);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.opt_out_customer_by_phone(uuid, text) FROM PUBLIC, anon, authenticated;

-- Anonimlestirme: izin de kapanir; WhatsApp asistani yazismalari da silinir
-- (onceden kaliyordu).
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
      marketing_consent = false
  WHERE id = p_customer_id;

  DELETE FROM public.customer_group_members WHERE customer_id = p_customer_id;

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
