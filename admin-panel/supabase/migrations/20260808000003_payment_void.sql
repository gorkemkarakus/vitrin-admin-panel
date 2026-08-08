-- Odemeler artik hard-delete degil, "voided" (iptal) olarak isaretleniyor —
-- yanlislikla girilen bir odeme musteri gecmisinden tamamen kaybolmak yerine
-- "Silindi" rozetiyle listede kalir, ama tum mali toplamlardan (kazanc, ciro,
-- kalan odeme, tahsilat vb.) haric tutulur.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS voided_at timestamptz;
