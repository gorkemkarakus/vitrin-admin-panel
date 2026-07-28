-- Guvenlik denetimi bulgusu: staff-whatsapp-webhook --no-verify-jwt ile
-- calisiyor (kimlik sadece telefon numarasindan cozuluyor) ve
-- public-book-appointment'in aksine HICBIR rate-limit'i yoktu — kayitli bir
-- personel telefon numarasini ogrenen biri sinirsiz istek atip her
-- birinde gercek paraya mal olan bir OpenAI cagrisi tetikleyebilirdi.
CREATE TABLE IF NOT EXISTS public.staff_whatsapp_attempts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_staff_whatsapp_attempts_phone_time
  ON public.staff_whatsapp_attempts (phone, created_at);

-- public_booking_attempts ile ayni desen — RLS acik, client policy yok,
-- sadece service_role yazip okuyabilir.
ALTER TABLE public.staff_whatsapp_attempts ENABLE ROW LEVEL SECURITY;
