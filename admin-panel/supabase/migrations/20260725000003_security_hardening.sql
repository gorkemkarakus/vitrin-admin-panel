-- Guvenlik denetimi bulgusu: my_business_id() ve my_role() — TUM RLS
-- politikalarinin dayandigi iki temel fonksiyon — SECURITY DEFINER ama
-- search_path SABITLENMEMISTI. Bu, bilinen bir Postgres guvenlik acigi
-- kalibi (search_path hijacking): SECURITY DEFINER bir fonksiyon search_path
-- pinlenmezse CAGIRANIN search_path'ini miras alir; sema yazma yetkisi olan
-- biri "public.profiles" gorunumunde sahte bir nesne olusturup fonksiyonu
-- kendi sahte verisine yonlendirebilir. Supabase'in "authenticated" rolu
-- varsayilan olarak public semasina yazamadigi icin gercek sömürülebilirlik
-- su an dusuk, ama bu tam olarak Supabase'in kendi guvenlik linter'inin
-- ("Function Search Path Mutable") isaretledigi kalip — davranis DEGISMEDEN,
-- sifir riskle kapatiliyor.
CREATE OR REPLACE FUNCTION public.my_business_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT business_id FROM public.profiles
  WHERE id = auth.uid() AND is_active = true
$$;

CREATE OR REPLACE FUNCTION public.my_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.profiles
  WHERE id = auth.uid() AND is_active = true
$$;
