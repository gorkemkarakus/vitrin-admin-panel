-- =============================================================================
-- Salonun kendi WhatsApp numarasini baglamasi (Meta Embedded Signup,
-- Coexistence: salon telefondaki WhatsApp Business uygulamasini kullanmaya
-- devam eder, ayni numarada asistan da calisir).
--
-- business_whatsapp_connections: baglanan numara + salona ozel erisim
-- anahtari (sifreli). Gelen mesajin hangi salona ait oldugu yine
-- businesses.whatsapp_phone_number_id ile bulunur; baglaninca o da doldurulur.
-- Anahtar ve PIN hicbir istemci rolune acilmaz (yalniz service_role).
--
-- whatsapp_connect_sessions: uygulamadan acilan baglama sayfasinin tek
-- kullanimlik, kisa omurlu oturumu. Sayfa salonun giris anahtarini (JWT)
-- tasimaz; yalniz bu oturum kodunu tasir, kod veritabaninda ozetiyle durur.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.business_whatsapp_connections (
  business_id             uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  waba_id                 text NOT NULL,
  phone_number_id         text NOT NULL UNIQUE,
  display_phone_number    text,
  verified_name           text,
  -- true: numara telefondaki WhatsApp Business uygulamasinda da kullaniliyor
  coexistence             boolean NOT NULL DEFAULT false,
  encrypted_access_token  text NOT NULL,
  -- yalniz yeni (uygulamada olmayan) numara kaydedilirken uretilen iki adimli dogrulama PIN'i
  encrypted_pin           text,
  connected_by            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  connected_at            timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_business_whatsapp_connections_updated_at
  BEFORE UPDATE ON public.business_whatsapp_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.business_whatsapp_connections ENABLE ROW LEVEL SECURITY;

-- Isletme sahibi baglanti durumunu gorur; yazma yalniz edge function'lardan.
CREATE POLICY "business_whatsapp_connections_select_admin"
  ON public.business_whatsapp_connections FOR SELECT
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  );

-- Tablo seviyesindeki SELECT hakki kolon REVOKE'unu gecersiz kilar; bu yuzden
-- once her sey geri alinir, sonra yalniz zararsiz kolonlar acilir.
REVOKE ALL ON TABLE public.business_whatsapp_connections FROM anon, authenticated;
GRANT SELECT (business_id, display_phone_number, verified_name, coexistence, connected_at)
  ON public.business_whatsapp_connections TO authenticated;

CREATE TABLE IF NOT EXISTS public.whatsapp_connect_sessions (
  token_hash   text PRIMARY KEY,
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_connect_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.whatsapp_connect_sessions FROM anon, authenticated;

CREATE INDEX idx_whatsapp_connect_sessions_expires ON public.whatsapp_connect_sessions (expires_at);

NOTIFY pgrst, 'reload schema';
