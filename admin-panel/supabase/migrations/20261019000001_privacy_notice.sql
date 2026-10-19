-- Salonun kendi musterilerine yonelik KVKK aydinlatma metni. Salonlar veri
-- sorumlusu oldugu icin metinde salonun unvani ve iletisim bilgisi yer almali;
-- businesses tablosunda bu alanlar yok. Metnin kendisi uygulamada sablondan
-- uretilir (src/legal/salonNotice.ts), burada yalnizca salonun bilgileri durur.
-- Herkese acik sayfa: /aydinlatma/<slug> (giris gerektirmez).

CREATE TABLE IF NOT EXISTS public.business_privacy_notices (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  legal_name text NOT NULL CHECK (char_length(btrim(legal_name)) BETWEEN 2 AND 200),
  address text NOT NULL CHECK (char_length(btrim(address)) BETWEEN 5 AND 300),
  contact_email text CHECK (contact_email IS NULL OR (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' AND char_length(contact_email) <= 200)),
  contact_phone text CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 32),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (contact_email IS NOT NULL OR contact_phone IS NOT NULL)
);

ALTER TABLE public.business_privacy_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_privacy_notices FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.business_privacy_notices TO authenticated;
DROP POLICY IF EXISTS privacy_notices_select ON public.business_privacy_notices;
CREATE POLICY privacy_notices_select ON public.business_privacy_notices
  FOR SELECT TO authenticated USING (business_id = public.my_business_id());
DROP POLICY IF EXISTS privacy_notices_insert ON public.business_privacy_notices;
CREATE POLICY privacy_notices_insert ON public.business_privacy_notices
  FOR INSERT TO authenticated WITH CHECK (business_id = public.my_business_id() AND public.my_role() = 'admin');
DROP POLICY IF EXISTS privacy_notices_update ON public.business_privacy_notices;
CREATE POLICY privacy_notices_update ON public.business_privacy_notices
  FOR UPDATE TO authenticated
  USING (business_id = public.my_business_id() AND public.my_role() = 'admin')
  WITH CHECK (business_id = public.my_business_id() AND public.my_role() = 'admin');

-- Herkese acik sayfa icin: salon adi + aydinlatma bilgileri. Bilgi girilmemisse
-- yalnizca ad doner (sayfa "salon bilgilerini henuz tamamlamadi" der).
-- has_bot: asistan bagliysa metne WhatsApp yazismalari bolumu eklenir.
CREATE OR REPLACE FUNCTION public.privacy_notice(p_slug text)
RETURNS TABLE (business_name text, legal_name text, address text, contact_email text, contact_phone text,
  has_bot boolean, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.name, n.legal_name, n.address, n.contact_email, n.contact_phone,
    b.whatsapp_phone_number_id IS NOT NULL, n.updated_at
  FROM public.businesses b
  LEFT JOIN public.business_privacy_notices n ON n.business_id = b.id
  WHERE p_slug ~ '^[a-z0-9-]{1,80}$' AND b.slug = p_slug
$$;
REVOKE ALL ON FUNCTION public.privacy_notice(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.privacy_notice(text) TO anon, authenticated;
