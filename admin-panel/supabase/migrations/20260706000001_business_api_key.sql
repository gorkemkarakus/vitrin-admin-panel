-- =============================================================================
-- İşletmeye özel API anahtarı (n8n chatbot'un book-appointment Edge Function'ını
-- çağırırken kullanacağı kimlik). Ham anahtar sadece üretim anında görünür,
-- veritabanında SADECE hash'i tutulur (şifre gibi) — sızarsa bile ham anahtar
-- geri çıkarılamaz.
-- =============================================================================

ALTER TABLE public.businesses
  ADD COLUMN api_key_hash text UNIQUE;
