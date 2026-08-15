-- Randevu tamamlanirken bazi islemler (ek bakim, boya vb.) standart hizmet
-- fiyatindan daha pahaliya mal olabiliyor — musteri gerceginde odenmesi
-- gereken tutar hizmetin sabit fiyatindan sapabiliyor. Bu sutun, o TEK
-- randevuya ozel gercek ucreti tutar; NULL ise (varsayilan/hicbir zaman
-- degistirilmemisse) her yerde oldugu gibi services.price kullanilmaya
-- devam eder — geriye donuk uyumluluk icin ekstra bir migration/backfill
-- gerekmiyor.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS price_override numeric(10, 2) CHECK (price_override IS NULL OR price_override >= 0);
