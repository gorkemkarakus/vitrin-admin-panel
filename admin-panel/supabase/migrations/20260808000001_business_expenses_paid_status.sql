-- Giderlerin (fatura, maaş vb.) ödenip ödenmediğini ayrı takip etmek icin.
-- DEFAULT true: mevcut kayitlar zaten "harcanmis" sayiliyordu, geriye donuk
-- davranisi bozmamak icin odenmis kabul edilirler. Odenmemis giderler Net
-- Kar/Kalan Bakiye hesabina girmez ve Ana Sayfa'da gunu gecse bile "Yaklasan
-- Odemeler" listesinde gorunmeye devam eder.
ALTER TABLE public.business_expenses ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT true;
