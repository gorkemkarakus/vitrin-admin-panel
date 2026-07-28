-- =============================================================================
-- Hizmetlere işletme tarafından girilen açıklama alanı — chatbot, bir hizmet
-- hakkında bilgi istendiğinde kendi genel bilgisini uydurmak yerine bu metni
-- kullansın diye eklendi.
-- =============================================================================

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS description text;
