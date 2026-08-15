-- Musteri bakiyesi (on odeme/kredi). Bir randevu icin alinan tutar o
-- randevunun kendi ucretini (price_override/hizmet fiyati) asarsa, asan
-- kisim artik o randevunun payments kaydina eklenmiyor — musterinin
-- bakiyesine ekleniyor. Bakiye, DAHA SONRA HERHANGI bir randevuda (ayni
-- pakete/hizmete bagli olmasa bile) tamamen veya kismen dusulebiliyor.
--
-- Paketli randevularda bu mekanizma DEVREYE GIRMIYOR (bilerek) — bir
-- pakette fazla odenen tutar zaten paketin KENDI kalan bakiyesini
-- otomatik dusurup sonraki seansa yansiyor (mevcut, dogru davranis);
-- bakiyeye de eklenirse ayni tutar iki kere sayilmis olurdu.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS credit_balance numeric(10, 2) NOT NULL DEFAULT 0
    CHECK (credit_balance >= 0);

-- payments.method'a 'bakiye' eklendi — bir odemenin ne kadarinin musteri
-- bakiyesinden karsilandigini (nakit/kart'tan ayirt ederek) kayit altina
-- almak icin.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('nakit', 'kart', 'diger', 'bakiye'));

-- Geriye donuk tek seferlik aktarim: su ana kadar pakete bagli OLMAYAN,
-- tamamlanmis randevularda olusmus "fazla odeme" (ucretini asan tutar)
-- varsa, ilgili musterinin bakiyesine tasiniyor. payments tablosuna
-- DOKUNULMUYOR — sadece yeni bakiye sutunu bu mevcut durumdan baslatiliyor.
WITH standalone_excess AS (
  SELECT
    a.id AS appt_id,
    a.customer_id,
    GREATEST(0, COALESCE(pay.paid, 0) - COALESCE(a.price_override, s.price, 0)) AS excess
  FROM public.appointments a
  LEFT JOIN public.services s ON s.id = a.service_id
  LEFT JOIN (
    SELECT appointment_id, SUM(amount) AS paid
    FROM public.payments
    WHERE appointment_id IS NOT NULL
    GROUP BY appointment_id
  ) pay ON pay.appointment_id = a.id
  WHERE a.package_id IS NULL AND a.status = 'tamamlandi' AND a.customer_id IS NOT NULL
)
UPDATE public.customers c
SET credit_balance = c.credit_balance + sub.total_excess
FROM (
  SELECT customer_id, SUM(excess) AS total_excess
  FROM standalone_excess
  GROUP BY customer_id
) sub
WHERE c.id = sub.customer_id AND sub.total_excess > 0;
