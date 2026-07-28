-- Supabase'in kendi guvenlik denetleyicisinin (supabase db advisors) bulgulari.

-- ── 1) function_search_path_mutable — kalan 5 fonksiyon ────────────────
-- Tam govdeyi tekrar yazip yanlislikla bir satir kaybetme riskine girmemek
-- icin ALTER FUNCTION ile SADECE search_path ekleniyor, davranis degismiyor.
ALTER FUNCTION public.set_appointment_ends_at() SET search_path = public;
ALTER FUNCTION public.set_updated_at() SET search_path = public;
ALTER FUNCTION public.check_employee_schedule_hours() SET search_path = public;
ALTER FUNCTION public.tr_slugify(text) SET search_path = public;
ALTER FUNCTION public.set_business_slug() SET search_path = public;

-- ── 2) anon/authenticated_security_definer_function_executable ────────
-- my_business_id()/my_role() TUM RLS politikalarinin dayandigi fonksiyonlar
-- — "authenticated" rolunden EXECUTE'u ASLA kaldirma (kaldirilirsa butun
-- panel erisimi kirilir, RLS bu fonksiyonlari authenticated baglaminda
-- cagirir). Sadece "anon"dan kaldiriliyor: anon zaten auth.uid() NULL
-- dondugu icin bu fonksiyonlardan hicbir zaman anlamli veri alamiyordu,
-- bu sadece gereksiz saldiri yuzeyini kapatiyor.
REVOKE EXECUTE ON FUNCTION public.my_business_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_business_id() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.my_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_role() TO authenticated;

-- notify_appointment_created() SADECE trigger tarafindan cagrilir — hicbir
-- client (anon/authenticated) buna dogrudan /rest/v1/rpc/... ile ihtiyac
-- duymaz. Trigger'in ates lenmesi bu yetkiden ETKILENMEZ (trigger cagrisi
-- ayri bir mekanizma, RPC yetki kontrolune tabi degil).
REVOKE EXECUTE ON FUNCTION public.notify_appointment_created() FROM PUBLIC;

-- ── 3) extension_in_public — extension'lar public yerine extensions ───
--    semasina tasiniyor (bu Supabase projesinde extensions semasi zaten
--    var). btree_gist tasinabilir (extrelocatable=true) ve islec siniflari
--    kendi semasinda kaldigi icin mevcut EXCLUDE constraint'i etkilemez.
--    pg_net ise Supabase tarafindan extrelocatable=false olarak isaretli
--    (denendi, ALTER EXTENSION ... SET SCHEMA hata verdi) — DROP/CREATE
--    gerektirir ki bu net._http_response gecmisini ve olasi ic referanslari
--    riske atar, bu yuzden pg_net public semada BIRAKILDI (dusuk riskli,
--    bilinen bir linter notu olarak kaliyor).
ALTER EXTENSION btree_gist SET SCHEMA extensions;
