-- Supabase yeni tablolara authenticated icin varsayilan olarak tum yetkileri
-- verir; politika olmadigi icin zaten 0 satir etkilenir ama yazma yollari
-- yalnizca fonksiyonlar olsun diye yetkiler de acikca kaldirilir.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.surveys FROM authenticated;
REVOKE INSERT, UPDATE, TRUNCATE ON public.loyalty_redemptions FROM authenticated;
REVOKE DELETE, TRUNCATE ON public.loyalty_programs FROM authenticated;
REVOKE DELETE, TRUNCATE ON public.survey_settings FROM authenticated;
