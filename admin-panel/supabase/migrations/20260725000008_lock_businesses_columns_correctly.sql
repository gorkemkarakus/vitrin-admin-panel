-- Onceki migration (20260725000007) basarisiz oldu: Postgres'te businesses
-- tablosunda authenticated/anon icin zaten TABLO seviyesinde blanket SELECT/
-- UPDATE/INSERT/DELETE/TRUNCATE vardi (Supabase'in "her seyi ac, RLS satirlari
-- filtresin" varsayilan modeli) — sadece belirli bir SUTUNU REVOKE etmek bu
-- daha genis tablo-seviyesi yetkiyi gecersiz kilmiyor (test edilip dogrulandi).
--
-- Dogru yontem: 3 panelin (admin-panel/isletme_oto_web/isletme_oto_operator)
-- businesses tablosuna dokunan HER satiri tek tek tarandi (grep ile
-- dogrulandi). Sonuc: authenticated rolunun GERCEKTEN ihtiyaci olan tek sey
-- id (WHERE .eq('id',...) icin), slug, reminder_hours_before (okuma+yazma),
-- max_users. Baska HICBIR sutun client tarafindan kullanilmiyor.
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.businesses FROM authenticated, anon;

GRANT SELECT (id, slug, reminder_hours_before, max_users) ON public.businesses TO authenticated;
GRANT UPDATE (reminder_hours_before) ON public.businesses TO authenticated;

-- anon zaten businesses_select_own RLS'i yuzunden (my_business_id() NULL
-- donuyor) hicbir satira erisemiyordu — savunma derinligi icin anon'a hicbir
-- sutun geri acilmiyor (herkese acik akislarin tumu service_role uzerinden
-- gidiyor, RLS'e hic tabi degil).

NOTIFY pgrst, 'reload schema';
