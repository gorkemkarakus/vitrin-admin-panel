-- Telefon bildirimleri (push): cihaz kayitlari + randevu olaylarinda
-- send-push-notification edge function'ini cagiran trigger.
--
-- Gizli anahtar (_app_secrets.push_webhook_secret) ve FCM servis hesabi
-- (edge function secret FCM_SERVICE_ACCOUNT) bu dosyada YOK; elle ayarlanir.
-- Anahtar yoksa trigger sessizce hicbir sey yapmaz — randevu islemleri
-- bildirim altyapisindan asla etkilenmez.

CREATE TABLE IF NOT EXISTS public.push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_devices_profile_idx ON public.push_devices(profile_id);

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_devices FROM anon;
-- Istemci tabloya dogrudan yazmaz (token baska hesaba ait olabilir);
-- yalnizca kendi cihazlarini gorebilir, kayit RPC ile yapilir.
REVOKE INSERT, UPDATE, DELETE ON public.push_devices FROM authenticated;
DROP POLICY IF EXISTS push_devices_select_own ON public.push_devices;
CREATE POLICY push_devices_select_own ON public.push_devices
  FOR SELECT TO authenticated USING (profile_id = auth.uid());

-- Ayni telefonda hesap degisirse token yeni hesaba gecer.
CREATE OR REPLACE FUNCTION public.register_push_device(p_token text, p_platform text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business uuid;
BEGIN
  IF auth.uid() IS NULL OR coalesce(length(p_token), 0) < 20 OR length(p_token) > 4096 THEN
    RAISE EXCEPTION 'gecersiz istek';
  END IF;
  IF p_platform NOT IN ('android', 'ios', 'web') THEN
    RAISE EXCEPTION 'gecersiz platform';
  END IF;
  SELECT business_id INTO v_business FROM public.profiles WHERE id = auth.uid() AND is_active;
  IF v_business IS NULL THEN
    RAISE EXCEPTION 'profil bulunamadi';
  END IF;
  INSERT INTO public.push_devices (token, profile_id, business_id, platform)
  VALUES (p_token, auth.uid(), v_business, p_platform)
  ON CONFLICT (token) DO UPDATE
    SET profile_id = excluded.profile_id,
        business_id = excluded.business_id,
        platform = excluded.platform,
        last_seen_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_push_device(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.push_devices WHERE token = p_token AND profile_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.register_push_device(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unregister_push_device(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_device(text) TO authenticated;

-- Randevu olaylari: yeni randevu ve iptal. Kimin yaptigi (auth.uid()) da
-- gonderilir ki islemi yapan kisiye kendi isleminin bildirimi gitmesin.
CREATE OR REPLACE FUNCTION public.notify_push_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_event text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event := 'created';
  ELSIF NEW.status = 'iptal' AND OLD.status IS DISTINCT FROM 'iptal' THEN
    v_event := 'cancelled';
  ELSE
    RETURN NEW;
  END IF;

  SELECT value INTO v_secret FROM public._app_secrets WHERE name = 'push_webhook_secret';
  IF v_secret IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://rllvmyriopaulcmmynbe.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
      body := jsonb_build_object('event', v_event, 'appointment_id', NEW.id, 'actor_id', auth.uid())
    );
  EXCEPTION WHEN OTHERS THEN
    -- Bildirim gonderilemese de randevu islemi devam eder.
    RAISE WARNING 'push bildirimi kuyruga alinamadi: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_push_appointment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_push_appointment_created ON public.appointments;
CREATE TRIGGER trg_push_appointment_created
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.notify_push_appointment();

DROP TRIGGER IF EXISTS trg_push_appointment_cancelled ON public.appointments;
CREATE TRIGGER trg_push_appointment_cancelled
  AFTER UPDATE OF status ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.notify_push_appointment();
