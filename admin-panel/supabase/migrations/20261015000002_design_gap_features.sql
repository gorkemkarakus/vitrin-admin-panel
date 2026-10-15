-- =============================================================================
-- Tasarimda olup uygulamada eksik kalan ozellikler (2026-10-15)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Yeni yetki: "kendi kazancini gorsun"
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.all_employee_permissions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'randevu_tumu_gor', 'randevu_tumu_duzenle', 'odeme_al', 'kasa',
    'raporlar', 'ekip_yonet', 'hizmet_yonet', 'mesajlar', 'kendi_kazanc'
  ]::text[]
$$;

-- Prim orani: Kasa, Performans ya da kendi kazancini gorme yetkisiyle okunur.
DROP POLICY IF EXISTS "business_finance_settings_select_perm" ON public.business_finance_settings;
CREATE POLICY "business_finance_settings_select_perm"
  ON public.business_finance_settings FOR SELECT
  USING (
    business_id = public.my_business_id()
    AND (
      (SELECT public.has_perm('kasa'))
      OR (SELECT public.has_perm('raporlar'))
      OR (SELECT public.has_perm('kendi_kazanc'))
    )
  );


-- -----------------------------------------------------------------------------
-- 2) Prim odemeleri ("Odendi yap")
-- -----------------------------------------------------------------------------
-- Bir calisanin bir aylik primi odendiginde tek satir. Net kar hesabi zaten
-- prim oranini dusuyor; bu tablo sadece "odendi mi" takibi icin.
CREATE TABLE IF NOT EXISTS public.commission_payouts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  period_month date NOT NULL CHECK (extract(day FROM period_month) = 1),
  amount       numeric(10, 2) NOT NULL CHECK (amount >= 0),
  paid_at      date NOT NULL DEFAULT CURRENT_DATE,
  created_by   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, period_month)
);
CREATE INDEX IF NOT EXISTS idx_commission_payouts_business ON public.commission_payouts (business_id, period_month);

ALTER TABLE public.commission_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commission_payouts FROM anon;

DROP POLICY IF EXISTS "commission_payouts_select" ON public.commission_payouts;
CREATE POLICY "commission_payouts_select"
  ON public.commission_payouts FOR SELECT
  USING (
    business_id = public.my_business_id()
    AND (
      (SELECT public.has_perm('kasa'))
      OR (SELECT public.has_perm('raporlar'))
      OR (profile_id = auth.uid() AND (SELECT public.has_perm('kendi_kazanc')))
    )
  );

DROP POLICY IF EXISTS "commission_payouts_write" ON public.commission_payouts;
CREATE POLICY "commission_payouts_write"
  ON public.commission_payouts FOR ALL
  USING ((SELECT public.has_perm('kasa')) AND business_id = public.my_business_id())
  WITH CHECK (
    (SELECT public.has_perm('kasa'))
    AND business_id = public.my_business_id()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = commission_payouts.profile_id AND p.business_id = public.my_business_id())
  );


-- -----------------------------------------------------------------------------
-- 3) Hizmet: online randevuda gosterme + paket sablonu
-- -----------------------------------------------------------------------------
-- online_bookable=false: hizmet salonda yapilir/uygulamadan randevusu acilir
-- ama musteri online sayfadan secemez. package_sessions/package_price:
-- "Paket olarak satilabilir" (or. 10 seans · 5.500 TL) — randevu kapanisinda
-- "Seansli" secilince seans sayisi ve seans basi ucret buradan gelir.
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS online_bookable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS package_sessions integer CHECK (package_sessions IS NULL OR package_sessions BETWEEN 2 AND 100),
  ADD COLUMN IF NOT EXISTS package_price numeric(10, 2) CHECK (package_price IS NULL OR package_price >= 0);

ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_package_both_or_none;
ALTER TABLE public.services
  ADD CONSTRAINT services_package_both_or_none
  CHECK ((package_sessions IS NULL) = (package_price IS NULL));


-- -----------------------------------------------------------------------------
-- 4) Calisan: online randevuda secilebilir mi + ilk giriste sifre degistirme
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS online_bookable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Calisan kendi profilinde yalnizca ad/telefon gibi alanlari degistirebilir.
-- Onceden sadece rol ve isletme sabitti: pasife alinmis bir calisan acik
-- oturumla kendini tekrar aktif edebiliyordu. Artik is_active ve
-- online_bookable de sabit; must_change_password'u ise kendisi kapatir
-- (sifresini degistirdikten sonra).
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid())
    AND business_id = (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid())
    AND is_active = (SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid())
    AND online_bookable = (SELECT p.online_bookable FROM public.profiles p WHERE p.id = auth.uid())
  );


-- -----------------------------------------------------------------------------
-- 5) Randevu olay kaydi (Bildirimler: onayladi / tasidi / iptal etti)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appointment_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  appointment_id   uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  employee_id      uuid,
  customer_id      uuid,
  kind             text NOT NULL CHECK (kind IN ('durum', 'saat')),
  old_status       text,
  new_status       text,
  old_scheduled_at timestamptz,
  new_scheduled_at timestamptz,
  -- NULL = bot / online sayfa / sistem (service_role); dolu = uygulamadan degistiren.
  actor_id         uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointment_events_business_time ON public.appointment_events (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointment_events_appointment ON public.appointment_events (appointment_id);

ALTER TABLE public.appointment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appointment_events FROM anon;
-- Yalnizca okuma; satirlar tetikleyiciyle yazilir.
REVOKE INSERT, UPDATE, DELETE ON public.appointment_events FROM authenticated;

DROP POLICY IF EXISTS "appointment_events_select" ON public.appointment_events;
CREATE POLICY "appointment_events_select"
  ON public.appointment_events FOR SELECT
  USING (
    business_id = public.my_business_id()
    AND ((SELECT public.has_perm('randevu_tumu_gor')) OR employee_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.log_appointment_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new.status IS DISTINCT FROM old.status THEN
    INSERT INTO public.appointment_events
      (business_id, appointment_id, employee_id, customer_id, kind, old_status, new_status, actor_id)
    VALUES
      (new.business_id, new.id, new.employee_id, new.customer_id, 'durum', old.status, new.status, auth.uid());
  END IF;
  IF new.scheduled_at IS DISTINCT FROM old.scheduled_at THEN
    INSERT INTO public.appointment_events
      (business_id, appointment_id, employee_id, customer_id, kind, old_scheduled_at, new_scheduled_at, actor_id)
    VALUES
      (new.business_id, new.id, new.employee_id, new.customer_id, 'saat', old.scheduled_at, new.scheduled_at, auth.uid());
  END IF;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION public.log_appointment_event() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_log_appointment_event ON public.appointments;
CREATE TRIGGER trg_log_appointment_event
  AFTER UPDATE ON public.appointments
  FOR EACH ROW
  WHEN (old.status IS DISTINCT FROM new.status OR old.scheduled_at IS DISTINCT FROM new.scheduled_at)
  EXECUTE FUNCTION public.log_appointment_event();


-- -----------------------------------------------------------------------------
-- 6) Salonun kendi tanimladigi tatiller (bayramlar, arife yarim gun)
-- -----------------------------------------------------------------------------
-- Kapali gunler musaitlik icin yine her calisana employee_time_blocks
-- ('Resmi Tatil') olarak yazilir; bu tablo tatilin ADINI ve arife ayarini
-- tutar (listede "Ramazan Bayramı · 3 gün · arife 13:00" gostermek ve
-- silerken arife blogunu da bulmak icin).
CREATE TABLE IF NOT EXISTS public.business_holidays (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name             text NOT NULL CHECK (length(trim(name)) > 0),
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  eve_closes_at    time,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_business_holidays_business ON public.business_holidays (business_id, start_date);

ALTER TABLE public.business_holidays ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_holidays FROM anon;

DROP POLICY IF EXISTS "business_holidays_select" ON public.business_holidays;
CREATE POLICY "business_holidays_select"
  ON public.business_holidays FOR SELECT
  USING (business_id = public.my_business_id());

DROP POLICY IF EXISTS "business_holidays_write" ON public.business_holidays;
CREATE POLICY "business_holidays_write"
  ON public.business_holidays FOR ALL
  USING ((SELECT public.has_perm('ekip_yonet')) AND business_id = public.my_business_id())
  WITH CHECK ((SELECT public.has_perm('ekip_yonet')) AND business_id = public.my_business_id());

NOTIFY pgrst, 'reload schema';
