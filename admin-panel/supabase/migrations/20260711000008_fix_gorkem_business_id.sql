-- gorkem@gmail.com hesabı yanlışlıkla "Fit Studio" (bbbbbbbb-0000-0000-0000-000000000002)
-- işletmesine bağlanmıştı; bu oturumdaki tüm gerçek test verisi "Güzel Salon"
-- (aaaaaaaa-0000-0000-0000-000000000001) işletmesinde. Doğru işletmeye taşı.

UPDATE public.profiles
SET business_id = 'aaaaaaaa-0000-0000-0000-000000000001'
WHERE full_name = 'Görkem'
  AND business_id = 'bbbbbbbb-0000-0000-0000-000000000002';
