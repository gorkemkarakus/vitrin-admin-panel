-- Guvenlik denetimi bulgusu: check_employee_schedule_hours() icin daha once
-- (20260725000004) eklenen "SET search_path = public" pinlemesi,
-- 20260807000003'teki CREATE OR REPLACE FUNCTION ile sessizce kaybolmustu
-- (Postgres, CREATE OR REPLACE'te onceki ALTER FUNCTION ile eklenen config
-- ayarlarini korumuyor). Yeniden pinleniyor.
ALTER FUNCTION public.check_employee_schedule_hours() SET search_path = public;
