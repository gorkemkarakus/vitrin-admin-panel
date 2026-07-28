-- Seed migration LIMIT 1 (sırasız) kullandığı için 4 test gideri yanlışlıkla
-- "Fit Studio" (bbbbbbbb-...0002) işletmesine düştü; "Güzel Salon"a (aaaaaaaa-...0001) taşı.

UPDATE public.business_expenses
SET business_id = 'aaaaaaaa-0000-0000-0000-000000000001'
WHERE business_id = 'bbbbbbbb-0000-0000-0000-000000000002'
  AND description IN ('Kira', 'Malzeme (oje, aseton vb.)', 'Elektrik faturası', 'Temizlik malzemesi')
  AND amount IN (15000, 2350.50, 1840, 620);
