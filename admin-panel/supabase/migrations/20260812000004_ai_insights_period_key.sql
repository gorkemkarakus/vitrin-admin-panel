-- business_ai_insights su ana kadar isletme basina TEK satirdi (tek
-- generated_at/cooldown, tum donemler paylasiyordu) — kullanici tarih
-- araligi degistirdiginde AI'in otomatik yeniden analiz yapmasini istedi,
-- ama ORTAK cooldown yuzunden bir donem icin analiz alinca digerleri de
-- kilitleniyordu. Artik donem basina (Bu Ay/Son 3 Ay/Son Yil/Tum Zamanlar)
-- AYRI satir + AYRI cooldown olacak sekilde composite primary key'e geciliyor.
ALTER TABLE public.business_ai_insights
  ADD COLUMN period_key text NOT NULL DEFAULT 'bu_ay';

ALTER TABLE public.business_ai_insights
  DROP CONSTRAINT business_ai_insights_pkey;

ALTER TABLE public.business_ai_insights
  ADD PRIMARY KEY (business_id, period_key);
