-- Pasif musteri temizligi: kullanicinin istegiyle, mobil uygulamadaki
-- Musteriler > "Pasif" segmentine giren TUM musteri kayitlari (ve varsa
-- bunlara ait, musteri silindiginde sahipsiz kalacak eski randevu
-- kayitlari) kalici olarak siliniyor.
--
-- Kriter, CustomersPage.tsx'teki segmentFor() mantigiyla BIREBIR ayni:
-- bu ay eklenmemis VE 3'ten az tamamlanmis randevusu var VE (hic ilgili
-- -iptal disi- randevusu yok YA DA son ilgili randevusunun uzerinden
-- 90+ gun gecmis). Bu, hic randevu almadan sadece isim/telefon paylasan
-- chatbot temaslarini da kapsar (bkz. chatbot-context/index.ts — bot,
-- musteri kendini tanitir tanitmaz customers tablosuna satir aciyor,
-- randevu almasi sart degil).
--
-- Musteriye bagli service_packages/payments kayitlari FK'daki
-- ON DELETE CASCADE ile musteri silinince otomatik temizlenir; ancak
-- appointments.customer_id ON DELETE SET NULL oldugu icin randevular
-- musteri silinince silinmez, sahipsiz kalir — bu yuzden musteriyi
-- silmeden ONCE bu musterilere ait TUM randevular ayrica siliniyor.
--
-- En cok musteri kaydi olan (aktif test) isletmeye ait veriler etkileniyor
-- — diger isletmelere dokunulmuyor.

DO $$
DECLARE
  v_business_id   uuid;
  v_month_start   timestamptz := date_trunc('month', now());
  v_deleted_count integer;
BEGIN
  SELECT business_id INTO v_business_id
  FROM public.customers
  GROUP BY business_id
  ORDER BY count(*) DESC
  LIMIT 1;

  IF v_business_id IS NULL THEN
    RAISE NOTICE 'Musteri bulunamadi, silinecek bir sey yok.';
    RETURN;
  END IF;

  CREATE TEMP TABLE pasif_customers ON COMMIT DROP AS
  WITH stats AS (
    SELECT
      c.id,
      c.created_at,
      (
        SELECT count(*) FROM public.appointments a
        WHERE a.customer_id = c.id AND a.status = 'tamamlandi'
      ) AS completed_count,
      (
        SELECT max(a.scheduled_at) FROM public.appointments a
        WHERE a.customer_id = c.id AND a.status <> 'iptal'
      ) AS last_relevant_at
    FROM public.customers c
    WHERE c.business_id = v_business_id
  )
  SELECT id FROM stats
  WHERE created_at < v_month_start
    AND completed_count < 3
    AND (last_relevant_at IS NULL OR now() - last_relevant_at > interval '90 days');

  SELECT count(*) INTO v_deleted_count FROM pasif_customers;
  RAISE NOTICE '% pasif musteri (ve eski randevulari) silinecek.', v_deleted_count;

  DELETE FROM public.appointments
  WHERE customer_id IN (SELECT id FROM pasif_customers);

  DELETE FROM public.customers
  WHERE id IN (SELECT id FROM pasif_customers);
END $$;
