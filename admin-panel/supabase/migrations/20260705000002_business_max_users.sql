-- =============================================================================
-- İşletmeye özel kullanıcı koltuk limiti.
-- Sabit "5 kullanıcı" kuralı yerine her işletmenin anlaşmasına göre değişebilir
-- (4, 5, 10...). İşletme sisteme kaydedilirken (operatör tarafından, businesses
-- tablosuna INSERT ile) bu değer belirlenir. 5 kullanıcı limitini zorunlu kılan
-- Edge Function bu kolonu okuyacak.
-- =============================================================================

ALTER TABLE public.businesses
  ADD COLUMN max_users integer NOT NULL DEFAULT 5 CHECK (max_users > 0);
