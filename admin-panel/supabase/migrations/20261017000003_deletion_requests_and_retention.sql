-- 1) Uygulamaya girmeden hesap/veri silme talebi (Google Play "hesap silme
--    URL'si" zorunlulugu + KVKK md. 11 basvurulari). Talepler yalnizca
--    account-deletion-request edge function'i uzerinden (service role) yazilir;
--    platform operatoru Supabase panelinden isler.
-- 2) Kisisel veri iceren gunluk/ham kayitlar icin saklama suresi ve gunluk
--    temizlik gorevi (oncesinde hicbir temizlik yoktu, veriler suresiz kaliyordu).

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('account', 'customer')),
  contact text NOT NULL CHECK (char_length(contact) BETWEEN 3 AND 254),
  full_name text CHECK (char_length(full_name) <= 120),
  business_name text CHECK (char_length(business_name) <= 120),
  note text CHECK (char_length(note) <= 1000),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'done', 'rejected')),
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz
);
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_requests FROM anon, authenticated;

-- Saklama sureleri (gun). Degistirmek icin bu fonksiyonu guncelle.
CREATE OR REPLACE FUNCTION public.purge_expired_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Meta'dan gelen ham webhook yukleri (mesaj metni + telefon icerir).
  DELETE FROM public.whatsapp_webhook_events WHERE received_at < now() - interval '30 days';
  DELETE FROM public.whatsapp_processed_messages WHERE created_at < now() - interval '30 days';
  -- Chatbot konusma gecmisi (bot baglami icin son konusmalar yeterli).
  DELETE FROM public.chatbot_messages WHERE created_at < now() - interval '180 days';
  -- Gonderilen bildirim/mesaj kaydi.
  DELETE FROM public.notification_log WHERE created_at < now() - interval '365 days';
  -- Kotuye kullanim/hiz siniri kayitlari.
  DELETE FROM public.public_booking_attempts WHERE created_at < now() - interval '7 days';
  DELETE FROM public.rate_limit_hits WHERE created_at < now() - interval '2 days';
  DELETE FROM public.staff_whatsapp_attempts WHERE created_at < now() - interval '7 days';
  DELETE FROM public.parse_command_attempts WHERE created_at < now() - interval '7 days';
  DELETE FROM public.campaign_message_attempts WHERE created_at < now() - interval '7 days';
  DELETE FROM public.bulk_campaign_attempts WHERE created_at < now() - interval '7 days';
  DELETE FROM public.business_usage_daily WHERE day < (now() AT TIME ZONE 'Europe/Istanbul')::date - 90;
  -- Yarim kalmis WhatsApp personel komut taslaklari.
  DELETE FROM public.staff_command_sessions WHERE created_at < now() - interval '1 day';
  -- Islenmis silme talepleri (kayit 1 yil ispat icin tutulur).
  DELETE FROM public.account_deletion_requests WHERE status IN ('done', 'rejected') AND handled_at < now() - interval '365 days';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_expired_data() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-expired-data') THEN
    PERFORM cron.unschedule('purge-expired-data');
  END IF;
  -- 02:30 UTC = 05:30 Istanbul.
  PERFORM cron.schedule('purge-expired-data', '30 2 * * *', 'SELECT public.purge_expired_data()');
END;
$$;
