-- Onceki migration'da REVOKE ... FROM PUBLIC yeterli olmadi — Supabase yeni
-- fonksiyonlara otomatik olarak anon/authenticated'e DOGRUDAN (PUBLIC
-- uzerinden degil) EXECUTE veriyor, bu yuzden PUBLIC'ten almak bu acik
-- grantlari etkilemiyor (pg_proc.proacl ile dogrulandi). Rollerden DOGRUDAN
-- aliniyor.
REVOKE EXECUTE ON FUNCTION public.my_business_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_role() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_appointment_created() FROM anon, authenticated;
