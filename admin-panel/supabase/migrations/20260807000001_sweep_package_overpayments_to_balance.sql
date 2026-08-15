-- Onceki migration (20260806000006) sadece PAKETSIZ randevulardaki fazla
-- odemeleri musteri bakiyesine tasimisti — o zaman paket ici fazla odeme
-- BILEREK dokunulmamisti (paketin kendi kalan hesabinin bunu zaten
-- "sonraki seansa" yansittigi varsayilmisti). Ama AppointmentsPage
-- submitCompletion artik PAKETLI randevularda da fazlaligi (paketin TUM
-- seanslarinin guncel toplamina gore) dogrudan musteri bakiyesine
-- aktariyor — bu yuzden su ana kadar OLUSMUS paket ici fazla odemeler de
-- ayni sekilde bakiyeye tasiniyor (payments tablosuna DOKUNULMUYOR,
-- sadece credit_balance bu mevcut durumdan baslatiliyor).
WITH package_excess AS (
  SELECT
    pkg.id AS package_id,
    pkg.customer_id,
    GREATEST(
      0,
      COALESCE((SELECT SUM(p.amount) FROM public.payments p WHERE p.package_id = pkg.id), 0)
      -
      (
        COALESCE((
          SELECT SUM(COALESCE(a.price_override, s.price, 0))
          FROM public.appointments a
          WHERE a.package_id = pkg.id
        ), 0)
        +
        GREATEST(
          0,
          pkg.total_sessions - COALESCE((SELECT COUNT(*) FROM public.appointments a WHERE a.package_id = pkg.id), 0)
        ) * COALESCE(s.price, 0)
      )
    ) AS excess
  FROM public.service_packages pkg
  LEFT JOIN public.services s ON s.id = pkg.service_id
)
UPDATE public.customers c
SET credit_balance = c.credit_balance + sub.total_excess
FROM (
  SELECT customer_id, SUM(excess) AS total_excess
  FROM package_excess
  WHERE excess > 0
  GROUP BY customer_id
) sub
WHERE c.id = sub.customer_id AND sub.total_excess > 0;
