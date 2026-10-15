-- businesses tablosu 20260725000008'den beri SUTUN seviyesinde kilitli:
-- authenticated yalnizca (id, slug, reminder_hours_before, max_users, name)
-- okuyabiliyor, yalnizca reminder_hours_before yazabiliyor.
--
-- 1) Mobil Ayarlar > "Salon bilgileri" salon adini degistiriyor. Satir
--    izni zaten businesses update politikasiyla (my_role() = 'admin' AND
--    id = my_business_id()) yoneticiye sinirli; burada sadece 'name' SUTUNU
--    yazmaya aciliyor. max_users / api_key_hash / whatsapp_phone_number_id
--    kapali kalir.
GRANT UPDATE (name) ON public.businesses TO authenticated;

-- 2) Mobil Mesajlar ve Ayarlar ekranlari "bot calisiyor mu" bilgisini
--    gosteriyor. whatsapp_phone_number_id sutununu istemciye acmak yerine
--    sadece evet/hayir donduren bir fonksiyon (kimligin kendisi disari
--    cikmiyor).
CREATE OR REPLACE FUNCTION public.my_business_bot_connected()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT whatsapp_phone_number_id IS NOT NULL
  FROM public.businesses
  WHERE id = public.my_business_id()
$$;

REVOKE ALL ON FUNCTION public.my_business_bot_connected() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_business_bot_connected() TO authenticated;

NOTIFY pgrst, 'reload schema';
