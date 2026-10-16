-- Guvenlik testi bulgulari (2026-10-16)
--
-- 1) Oturumsuz (anon) rolun public semasindaki tablolarda Supabase'in
--    varsayilan "her seye izin" yetkileri duruyordu; satirlari sadece RLS
--    koruyordu. Uygulamanin oturum acmadan yaptigi tek sey giris ve
--    edge function cagrilari (online randevu dahil hepsi service_role ile
--    calisir) — anon'un hicbir tabloya/fonksiyona dogrudan ihtiyaci yok.
--    Ikinci bir kilit olarak tum yetkileri kaldiriliyor; yeni tablolar da
--    varsayilan olarak anon'a acilmayacak.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- 2) business_ad_connections.encrypted_access_token: 20260810000001'de
--    sutun yetkisi geri alinmisti ama tablo seviyesindeki SELECT durdugu
--    icin etkisizdi (yonetici kendi isletmesinin sifreli Meta token'ini
--    okuyabiliyordu). Tablo yetkisi kaldirilip yalnizca uygulamanin
--    kullandigi sutunlar aciliyor; yazma zaten yalnizca edge function'larda
--    (service_role).
REVOKE ALL ON public.business_ad_connections FROM authenticated;
GRANT SELECT (business_id, provider, status, ad_account_id, ad_account_name, token_expires_at,
              last_synced_at, last_error, connected_by, connected_at, created_at, updated_at)
  ON public.business_ad_connections TO authenticated;

NOTIFY pgrst, 'reload schema';
