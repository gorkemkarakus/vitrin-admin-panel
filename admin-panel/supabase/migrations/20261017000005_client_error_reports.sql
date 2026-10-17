-- Uygulama hata raporlari (kisisel veri icermez): istemci mesaj ve yigini
-- gondermeden once e-posta/telefon/uzun sayi dizilerini temizler
-- (src/lib/errorReporting.ts). Ucuncu taraf hata servisi kullanilmiyor.

CREATE TABLE IF NOT EXISTS public.client_error_reports (
  id bigserial PRIMARY KEY,
  profile_id uuid,
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  message text NOT NULL CHECK (char_length(message) <= 500),
  stack text CHECK (char_length(stack) <= 4000),
  route text CHECK (char_length(route) <= 200),
  app_version text CHECK (char_length(app_version) <= 20),
  platform text CHECK (char_length(platform) <= 20),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_error_reports_created ON public.client_error_reports (created_at);
ALTER TABLE public.client_error_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.client_error_reports FROM anon, authenticated;

-- Oturumlu kullanici basina saatte en fazla 30 rapor (hit_rate_limit).
CREATE OR REPLACE FUNCTION public.report_client_error(
  p_message text,
  p_stack text DEFAULT NULL,
  p_route text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_platform text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR p_message IS NULL OR btrim(p_message) = '' THEN
    RETURN;
  END IF;
  IF NOT public.hit_rate_limit('client-error', v_uid::text, 30, 3600) THEN
    RETURN;
  END IF;
  INSERT INTO public.client_error_reports (profile_id, business_id, message, stack, route, app_version, platform)
  VALUES (
    v_uid,
    public.my_business_id(),
    left(p_message, 500),
    left(p_stack, 4000),
    left(p_route, 200),
    left(p_app_version, 20),
    left(p_platform, 20)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.report_client_error(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_client_error(text, text, text, text, text) TO authenticated;

-- Saklama: 30 gun (purge_expired_data'ya eklenir).
CREATE OR REPLACE FUNCTION public.purge_expired_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.whatsapp_webhook_events WHERE received_at < now() - interval '30 days';
  DELETE FROM public.whatsapp_processed_messages WHERE created_at < now() - interval '30 days';
  DELETE FROM public.chatbot_messages WHERE created_at < now() - interval '180 days';
  DELETE FROM public.notification_log WHERE created_at < now() - interval '365 days';
  DELETE FROM public.public_booking_attempts WHERE created_at < now() - interval '7 days';
  DELETE FROM public.rate_limit_hits WHERE created_at < now() - interval '2 days';
  DELETE FROM public.staff_whatsapp_attempts WHERE created_at < now() - interval '7 days';
  DELETE FROM public.parse_command_attempts WHERE created_at < now() - interval '7 days';
  DELETE FROM public.campaign_message_attempts WHERE created_at < now() - interval '7 days';
  DELETE FROM public.bulk_campaign_attempts WHERE created_at < now() - interval '7 days';
  DELETE FROM public.business_usage_daily WHERE day < (now() AT TIME ZONE 'Europe/Istanbul')::date - 90;
  DELETE FROM public.staff_command_sessions WHERE created_at < now() - interval '1 day';
  DELETE FROM public.account_deletion_requests WHERE status IN ('done', 'rejected') AND handled_at < now() - interval '365 days';
  DELETE FROM public.client_error_reports WHERE created_at < now() - interval '30 days';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_expired_data() FROM PUBLIC, anon, authenticated;
