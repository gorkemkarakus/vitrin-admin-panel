-- =============================================================================
-- VİTRİN — İlk şema: multi-tenant işletme yönetim paneli
-- =============================================================================
-- Çalıştırma: Supabase Dashboard → SQL Editor → Bu dosyayı yapıştır → RUN
-- =============================================================================

-- ── updated_at otomatik güncelleme fonksiyonu ─────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 1. businesses — her SaaS müşterisi bir işletme ───────────────────────
CREATE TABLE IF NOT EXISTS public.businesses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_businesses_updated_at
  BEFORE UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 2. profiles — auth.users ile eşleşen kullanıcı profilleri ────────────
-- Her kullanıcı bir işletmeye ve role (admin | user) sahiptir.
CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  full_name   text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_business_id ON public.profiles (business_id);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 3. customers — işletmeye ait müşteriler ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  phone       text,
  email       text,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Aynı işletmede aynı telefon numarası ile birden fazla müşteri olmasın
CREATE UNIQUE INDEX uq_customers_business_phone
  ON public.customers (business_id, phone) WHERE phone IS NOT NULL;

CREATE INDEX idx_customers_business_id ON public.customers (business_id);

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. services — işletmenin sunduğu hizmetler ───────────────────────────
CREATE TABLE IF NOT EXISTS public.services (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name             text NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 60,
  price            numeric(10, 2),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_services_business_id ON public.services (business_id);

CREATE TRIGGER trg_services_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 5. appointments — randevular (kaynak attribution dahil) ──────────────
CREATE TABLE IF NOT EXISTS public.appointments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id        uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  service_id         uuid REFERENCES public.services(id) ON DELETE SET NULL,

  -- Randevuyu sisteme hangi çalışan girdi? (reklam kaynaklıysa NULL olabilir)
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  scheduled_at       timestamptz NOT NULL,
  duration_minutes   integer,

  status text NOT NULL DEFAULT 'bekliyor'
    CHECK (status IN ('bekliyor', 'onaylandi', 'tamamlandi', 'iptal')),

  -- Kaynak: randevu nereden geldi?
  source text NOT NULL DEFAULT 'kullanici_uzerinden'
    CHECK (source IN (
      'reklam_instagram',
      'reklam_whatsapp',
      'kullanici_uzerinden',
      'dogrudan_musteri',
      'diger'
    )),

  -- Opsiyonel not: kampanya adı, referans kişi vb.
  source_note text,
  notes       text,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointments_business_id      ON public.appointments (business_id);
CREATE INDEX idx_appointments_scheduled_at     ON public.appointments (scheduled_at);
CREATE INDEX idx_appointments_created_by_user  ON public.appointments (created_by_user_id);
CREATE INDEX idx_appointments_status           ON public.appointments (status);

CREATE TRIGGER trg_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- SECURITY DEFINER yardımcı fonksiyonlar
-- Bu fonksiyonlar RLS'i atlayarak çalışır → policy'lerde circular reference olmaz
-- =============================================================================

-- Mevcut kullanıcının business_id'sini döndürür.
-- is_active = false ise NULL döner → tüm RLS kontrolleri başarısız → erişim yok.
CREATE OR REPLACE FUNCTION public.my_business_id()
RETURNS uuid AS $$
  SELECT business_id FROM public.profiles
  WHERE id = auth.uid() AND is_active = true
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Mevcut kullanıcının rolünü döndürür ('admin' | 'user' | NULL)
CREATE OR REPLACE FUNCTION public.my_role()
RETURNS text AS $$
  SELECT role FROM public.profiles
  WHERE id = auth.uid() AND is_active = true
$$ LANGUAGE SQL SECURITY DEFINER STABLE;
