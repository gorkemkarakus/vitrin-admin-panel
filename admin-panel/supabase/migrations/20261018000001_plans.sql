-- Paketler (Ucretsiz / Salon / Salon + Asistan). Sinirlar ve ozellikler
-- YALNIZCA bu tabloda: bir satiri guncellemek uygulama guncellemesi
-- gerektirmeden herkese aninda yansir. Fiyatlar burada DEGIL — magazada
-- (App Store / Play / RevenueCat) tanimlanir ve oradan okunur.
--
-- limits: null = sinirsiz, 0 = kapali.
-- features: kilitli ozelliklerin adlari (src/lib/plan.ts ile ayni).

CREATE TABLE IF NOT EXISTS public.plan_definitions (
  id text PRIMARY KEY,
  name text NOT NULL,
  sort int NOT NULL,
  limits jsonb NOT NULL,
  features text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.plan_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plan_definitions FROM anon, authenticated;
GRANT SELECT ON public.plan_definitions TO anon, authenticated;
DROP POLICY IF EXISTS plan_definitions_read ON public.plan_definitions;
CREATE POLICY plan_definitions_read ON public.plan_definitions FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.plan_definitions (id, name, sort, limits, features) VALUES
(
  'free', 'Ücretsiz', 1,
  '{"max_users": 1, "appointments_per_month": 100, "max_customers": 150, "reminders_per_month": 50,
    "ai_command_per_day": 0, "ai_insights_per_day": 0, "ai_campaign_per_day": 0,
    "bulk_recipients_per_day": 0, "bot_messages_per_month": 0}'::jsonb,
  '{}'
),
(
  'salon', 'Salon', 2,
  '{"max_users": 5, "appointments_per_month": null, "max_customers": null, "reminders_per_month": 500,
    "ai_command_per_day": 30, "ai_insights_per_day": 3, "ai_campaign_per_day": 0,
    "bulk_recipients_per_day": 0, "bot_messages_per_month": 0}'::jsonb,
  '{staff,pdf_reports,ai_command,ai_insights,unbranded_booking}'
),
(
  'asistan', 'Salon + Asistan', 3,
  '{"max_users": 10, "appointments_per_month": null, "max_customers": null, "reminders_per_month": null,
    "ai_command_per_day": 100, "ai_insights_per_day": 10, "ai_campaign_per_day": 30,
    "bulk_recipients_per_day": 500, "bot_messages_per_month": 10000}'::jsonb,
  '{staff,pdf_reports,ai_command,ai_insights,unbranded_booking,whatsapp_bot,instagram_bot,staff_whatsapp,messages,bulk_campaign,ads,own_number_reminders}'
)
ON CONFLICT (id) DO NOTHING;

-- Isletmenin paketi. Yalnizca sunucu (magaza bildirimi / operator) yazar.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'free' REFERENCES public.plan_definitions(id),
  ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS plan_source text CHECK (plan_source IN ('manual', 'app_store', 'play_store', 'web', 'trial')),
  ADD COLUMN IF NOT EXISTS plan_updated_at timestamptz;
GRANT SELECT (plan, plan_expires_at, plan_source) ON public.businesses TO authenticated;

-- Mevcut isletmeler (Guzel Salon, Fit Studio) hicbir ozellik kaybetmesin.
UPDATE public.businesses SET plan = 'asistan', plan_source = 'manual', plan_updated_at = now() WHERE plan = 'free';

-- Suresi dolmus ucretli paket ucretsize duser (veri silinmez).
CREATE OR REPLACE FUNCTION public.effective_plan(p_business uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN b.plan <> 'free' AND b.plan_expires_at IS NOT NULL AND b.plan_expires_at < now() THEN 'free'
    ELSE b.plan
  END
  FROM public.businesses b WHERE b.id = p_business
$$;

-- null = sinirsiz
CREATE OR REPLACE FUNCTION public.plan_limit(p_business uuid, p_key text)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (d.limits ->> p_key)::int FROM public.plan_definitions d WHERE d.id = public.effective_plan(p_business)
$$;

CREATE OR REPLACE FUNCTION public.plan_has(p_business uuid, p_feature text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(p_feature = ANY (d.features), false) FROM public.plan_definitions d WHERE d.id = public.effective_plan(p_business)
$$;

REVOKE EXECUTE ON FUNCTION public.effective_plan(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_limit(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.plan_has(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.effective_plan(uuid), public.plan_limit(uuid, text), public.plan_has(uuid, text) TO authenticated;

-- Istemci icin: oturumdaki isletmenin paketi, sinirlari, ozellikleri ve kullanimi.
CREATE OR REPLACE FUNCTION public.my_plan()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business uuid := public.my_business_id();
  v_plan text;
  v_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul';
  r jsonb;
BEGIN
  IF v_business IS NULL THEN
    RETURN NULL;
  END IF;
  v_plan := public.effective_plan(v_business);
  SELECT jsonb_build_object(
    'plan', v_plan,
    'name', d.name,
    'stored_plan', b.plan,
    'expires_at', b.plan_expires_at,
    'source', b.plan_source,
    'limits', d.limits,
    'features', to_jsonb(d.features),
    'usage', jsonb_build_object(
      'users', (SELECT count(*) FROM public.profiles p WHERE p.business_id = v_business AND p.is_active),
      'appointments_this_month', (SELECT count(*) FROM public.appointments a WHERE a.business_id = v_business AND a.created_at >= v_month_start),
      'customers', (SELECT count(*) FROM public.customers c WHERE c.business_id = v_business)
    )
  )
  INTO r
  FROM public.businesses b JOIN public.plan_definitions d ON d.id = v_plan
  WHERE b.id = v_business;
  RETURN r;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.my_plan() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_plan() TO authenticated;

-- ---- Sinirlar veritabaninda: uygulama, bot, online randevu — her yol icin gecerli ----
-- Hata metni "PLAN_LIMIT:<anahtar>" — istemci bunu Turkce mesaja ve
-- yukseltme ekranina cevirir (src/lib/dbErrors.ts).

CREATE OR REPLACE FUNCTION public.enforce_appointment_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int := public.plan_limit(NEW.business_id, 'appointments_per_month');
  v_month_start timestamptz := date_trunc('month', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul';
  v_used int;
BEGIN
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_used FROM public.appointments WHERE business_id = NEW.business_id AND created_at >= v_month_start;
  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'PLAN_LIMIT:appointments_per_month' USING ERRCODE = 'P0001', HINT = v_limit::text;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS appointments_plan_limit ON public.appointments;
CREATE TRIGGER appointments_plan_limit BEFORE INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_appointment_plan_limit();

CREATE OR REPLACE FUNCTION public.enforce_customer_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int := public.plan_limit(NEW.business_id, 'max_customers');
  v_used int;
BEGIN
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_used FROM public.customers WHERE business_id = NEW.business_id;
  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'PLAN_LIMIT:max_customers' USING ERRCODE = 'P0001', HINT = v_limit::text;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS customers_plan_limit ON public.customers;
CREATE TRIGGER customers_plan_limit BEFORE INSERT ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.enforce_customer_plan_limit();

-- Aktif kullanici sayisi: yeni hesap ACMA ve pasif hesabi tekrar AKTIF ETME
-- (eskiden yalnizca acarken kontrol ediliyordu) ikisi de buradan gecer.
CREATE OR REPLACE FUNCTION public.enforce_user_plan_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit int;
  v_used int;
BEGIN
  IF NOT NEW.is_active OR NEW.business_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_active AND OLD.business_id IS NOT DISTINCT FROM NEW.business_id THEN
    RETURN NEW;
  END IF;
  v_limit := public.plan_limit(NEW.business_id, 'max_users');
  IF v_limit IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO v_used FROM public.profiles
  WHERE business_id = NEW.business_id AND is_active AND id <> NEW.id;
  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'PLAN_LIMIT:max_users' USING ERRCODE = 'P0001', HINT = v_limit::text;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profiles_plan_limit ON public.profiles;
CREATE TRIGGER profiles_plan_limit BEFORE INSERT OR UPDATE OF is_active, business_id ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_plan_limit();
