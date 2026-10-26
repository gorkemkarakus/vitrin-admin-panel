-- =============================================================================
-- Salonun Instagram hesabini baglamasi ("Instagram ile giris" / Instagram API
-- with Instagram Login). Facebook sayfasi gerekmez; hesap profesyonel
-- (Isletme ya da Icerik Uretici) olmalidir.
--
-- business_instagram_connections: baglanan hesap + salona ozel erisim
-- anahtari (sifreli, 60 gun gecerli; instagram-refresh-tokens her gun
-- suresi yaklasanlari yeniler). Gelen DM'nin hangi salona ait oldugu
-- ig_user_id (webhook'taki entry.id) ile bulunur. Anahtar hicbir istemci
-- rolune acilmaz (yalniz service_role).
--
-- instagram_connect_sessions: uygulamadan acilan baglama sayfasinin tek
-- kullanimlik, kisa omurlu oturumu (WhatsApp'taki ile ayni desen).
--
-- Musteri kimligi: Instagram'dan yazan kisi chatbot_messages.customer_phone
-- ve customers.phone'da "ig:<IGSID>" olarak tutulur (gercek telefonu bot
-- sorar, customers.contact_phone'a yazilir; hatirlatmalar oradan WhatsApp'a gider).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.business_instagram_connections (
  business_id             uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  -- Instagram profesyonel hesap kimligi (webhook entry.id / recipient.id)
  ig_user_id              text NOT NULL UNIQUE,
  username                text,
  encrypted_access_token  text NOT NULL,
  token_expires_at        timestamptz,
  connected_by            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  connected_at            timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_business_instagram_connections_updated_at
  BEFORE UPDATE ON public.business_instagram_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.business_instagram_connections ENABLE ROW LEVEL SECURITY;

-- Isletme sahibi baglanti durumunu gorur; yazma yalniz edge function'lardan.
CREATE POLICY "business_instagram_connections_select_admin"
  ON public.business_instagram_connections FOR SELECT
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  );

REVOKE ALL ON TABLE public.business_instagram_connections FROM anon, authenticated;
GRANT SELECT (business_id, username, connected_at)
  ON public.business_instagram_connections TO authenticated;

CREATE TABLE IF NOT EXISTS public.instagram_connect_sessions (
  token_hash   text PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 'app': sayfa bitince uygulamaya derin baglantiyla doner; 'web': sekmede kalir
  return_to    text NOT NULL DEFAULT 'web' CHECK (return_to IN ('app', 'web')),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.instagram_connect_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.instagram_connect_sessions FROM anon, authenticated;

CREATE INDEX idx_instagram_connect_sessions_expires ON public.instagram_connect_sessions (expires_at);

-- Instagram anahtarlari 60 gun gecerli; her gece suresi yaklasanlar yenilenir.
SELECT cron.schedule(
  'instagram-refresh-tokens',
  '20 4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllvmyriopaulcmmynbe.supabase.co/functions/v1/instagram-refresh-tokens',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (SELECT value FROM public._app_secrets WHERE name = 'appointment_webhook_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

NOTIFY pgrst, 'reload schema';
