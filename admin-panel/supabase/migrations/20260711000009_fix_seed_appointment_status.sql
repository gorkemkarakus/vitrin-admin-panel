-- Önceki seed migration'ı customer.phone üzerinden eşleştirmeye çalışmıştı, ama seed script
-- gerçek telefon numaraları yerine webhook oturum kimliğini phone alanına yazmıştı — hiçbir
-- satır eşleşmedi. Bu sefer customer_id üzerinden doğru eşleştirip 3 randevuyu tamamlandı yap.

UPDATE public.appointments
SET status = 'tamamlandi'
WHERE customer_id IN (
  '03f6c931-1a3a-454c-8018-c2bd92c68d7f', -- Zeynep Aydın
  'efc577f8-88a7-4c96-8599-d9875e85916b', -- Elif Kaya
  'c2299d9e-9f3f-422c-97fa-61457f83b6ac'  -- Mehmet Yıldız
);
