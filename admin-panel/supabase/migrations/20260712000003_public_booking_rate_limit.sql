-- =============================================================================
-- Herkese açık randevu yazma uç noktası (public-book-appointment) kimliksiz —
-- book-appointment'ın aksine gizli bir x-api-key ile korunmuyor, internetten
-- doğrudan POST edilebilir. Aynı telefon numarasından saatte çok fazla deneme
-- olursa reddetmek için basit bir sayaç tablosu. Sadece service_role (edge
-- function) yazar/okur — RLS etkin ve hiç policy yok, yani anon/authenticated
-- hiçbir rolden erişilemez.
-- =============================================================================
CREATE TABLE public.public_booking_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  phone_digits text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_public_booking_attempts_lookup
  ON public.public_booking_attempts (business_id, phone_digits, created_at);

ALTER TABLE public.public_booking_attempts ENABLE ROW LEVEL SECURITY;
