-- Randevu HANGI yoldan olusursa olsun (chatbot, herkese acik randevu sayfasi,
-- operator paneli, isletmenin kendi paneli) tek bir merkezi noktadan onay
-- SMS'i gondermek icin: appointments'a INSERT sonrasi pg_net araciligiyla
-- send-appointment-confirmation edge function'ini asenkron cagiran bir
-- trigger. Boylece her randevu-olusturma yoluna ayri ayri SMS kodu eklemek
-- gerekmiyor.
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Webhook secret'i duz metin olarak trigger fonksiyonunun kaynagina GOMMEK
-- yerine kilitli, RLS'i acik ama HICBIR client policy'si olmayan (yani
-- platform_admins ile AYNI desen — sadece tablo sahibi/service_role okuyabilir)
-- ayri bir tabloda saklayip trigger'da oradan okuyoruz. Vault (pgsodium izin
-- hatasi) ve ALTER DATABASE (izin hatasi) bu Supabase projesinde calismadigi
-- icin bu daha basit yontem kullanildi. Deger BU DOSYADA yok — kullaniciya
-- ayri, elle calistirilan tek satirlik bir INSERT komutu verildi.
CREATE TABLE IF NOT EXISTS public._app_secrets (
  name  text PRIMARY KEY,
  value text NOT NULL
);
ALTER TABLE public._app_secrets ENABLE ROW LEVEL SECURITY;

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
    url := 'https://rllvmyriopaulcmmynbe.supabase.co/functions/v1/send-appointment-confirmation',
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
