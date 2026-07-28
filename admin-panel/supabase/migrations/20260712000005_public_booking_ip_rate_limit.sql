-- Telefon bazlı sınırlamaya ek olarak IP bazlı sınırlama: bir script farklı
-- sahte telefon numaraları üretse bile aynı IP'den geliyorsa yakalanır.
-- Ham IP yerine hash'i saklanır (gereksiz PII biriktirmemek için).
ALTER TABLE public.public_booking_attempts ADD COLUMN ip_hash text;

CREATE INDEX idx_public_booking_attempts_ip_lookup
  ON public.public_booking_attempts (business_id, ip_hash, created_at);
