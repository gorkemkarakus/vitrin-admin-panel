-- Randevu tamamlama akisi artik "Tek Seferlik" / "Seanslı" secimini zorunlu
-- kiliyor ve seanslı akista paket tamamlanınca otomatik kapatiliyor. Bu iki
-- yeni alan bunu destekliyor:
--
-- status: son seans tamamlandiginda 'tamamlandi' yapiliyor — bir paket
-- tamamlaninca "Mevcut Pakete Ekle" listesinden dusuyor, yeni seans
-- eklenemiyor.
--
-- session_offset: tamamlama aninda "Seanslı İşlem" ilk secildiginde
-- "Bu yapılan kaçıncı seans" alani 1'den buyukse (musteri sistem disinda
-- zaten bazi seanslari yapmissa), bu paketin "kalan seans" ve "toplam
-- beklenen tutar" hesaplarinin dogru cikmasi icin offset olarak saklaniyor.
-- Randevu formundan ("Yeni Paket") olusturulan paketlerde her zaman 0.
ALTER TABLE public.service_packages
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'aktif'
    CHECK (status IN ('aktif', 'tamamlandi'));

ALTER TABLE public.service_packages
  ADD COLUMN IF NOT EXISTS session_offset integer NOT NULL DEFAULT 0
    CHECK (session_offset >= 0);

-- Odeme yontemine "Havale/EFT" eklendi (Nakit / Kredi Kartı / Havale-EFT /
-- Diger — tamamlama ekraninda artik zorunlu secilmesi gereken 4 secenek).
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('nakit', 'kart', 'havale', 'diger', 'bakiye'));
