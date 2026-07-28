-- Stratejik pivot: SMS (iletiMerkezi) tamamen kaldiriliyor, TUM musteri
-- bilgilendirmesi (randevu onayi + hatirlatma) tek bir WhatsApp numarasi
-- uzerinden gidecek. WhatsApp Business baglantisi henuz kurulmadigi icin
-- gonderim katmani su an notification_log tablosuna YAZIYOR (gercek mesaj
-- gitmiyor) — _shared/notify.ts'teki TEK fonksiyon degistirilince (gercek
-- WhatsApp Cloud API cagrisi eklenince) butun akis (tetikleyiciler,
-- hatirlatma zamanlayicisi, mesaj icerigi) hic degismeden calismaya devam
-- eder. Boylece "kurabilecegin herseyi kur ve test et" istegi karsilaniyor.

-- ── Eski SMS trigger'ini kaldir ────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_notify_appointment_created ON public.appointments;
DROP FUNCTION IF EXISTS public.notify_appointment_created();

-- ── Bildirim gecmisi (test/dogrulama icin — gercek WhatsApp baglaninca da
--    "ne zaman kime ne gitti" gecmisi olarak kalmaya devam eder) ──────────
CREATE TABLE IF NOT EXISTS public.notification_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('confirmation', 'reminder')),
  phone       text,
  message     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_log_business ON public.notification_log (business_id, created_at DESC);
-- platform_admins/_app_secrets ile ayni desen: RLS acik, client policy YOK —
-- sadece service_role erisir (musteri iletisim gecmisi, kimseye dogrudan
-- client'tan acik olmamali).
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

-- ── Hatirlatma ayarlari ─────────────────────────────────────────────────
-- NULL = hatirlatma kapali. Isletme yoneticisi Ayarlar sayfasindan kac saat
-- once hatirlatma gitsin belirler (ornegin 2 = 2 saat once, 24 = 1 gun once).
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS reminder_hours_before integer;

-- businesses tablosunda daha once HICBIR update policy yoktu (sadece
-- service_role yazabiliyordu). Isletme admini kendi Ayarlar sayfasindan bu
-- alani (ve gerekirse isletme adini) dogrudan guncelleyebilsin diye
-- profiles_update_admin ile AYNI desende bir policy ekleniyor.
CREATE POLICY "businesses_update_admin"
  ON public.businesses FOR UPDATE
  USING (
    public.my_role() = 'admin'
    AND id = public.my_business_id()
  );

-- Ayni randevuya iki kere hatirlatma gitmesin diye isaretleme kolonu.
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- ── Randevu olusunca bildirim (SMS trigger'inin yerine, ayni pg_net deseni,
--    sadece hedef fonksiyon degisti) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_appointment_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  webhook_secret text;
BEGIN
  SELECT value INTO webhook_secret FROM public._app_secrets WHERE name = 'appointment_webhook_secret';

  PERFORM net.http_post(
    url := 'https://rllvmyriopaulcmmynbe.supabase.co/functions/v1/send-appointment-notification',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object('appointment_id', new.id)
  );
  RETURN new;
END;
$$;

CREATE TRIGGER trg_notify_appointment_created
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.notify_appointment_created();

-- ── Zamanlanmis hatirlatma taramasi ─────────────────────────────────────
-- pg_net zaten bu projede calisiyor (SMS trigger'inde kanitlandi); pg_cron
-- farkli bir extension, bu Supabase projesinde izin verilip verilmedigi
-- bilinmiyor (Vault/ALTER DATABASE gibi bazi extension'lar bu projede izin
-- hatasi vermisti) — calismazsa migration burada patlar ve dis bir cron
-- servisiyle (cron-job.org) ayni process-appointment-reminders fonksiyonunu
-- periyodik cagirma yoluna gecilir.
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'process-appointment-reminders',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllvmyriopaulcmmynbe.supabase.co/functions/v1/process-appointment-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (SELECT value FROM public._app_secrets WHERE name = 'appointment_webhook_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
