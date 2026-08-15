-- Veri onarimi: "devam randevusu olustur" akisinda (AppointmentsPage.tsx
-- submitCompletion) geriye donuk paket olusturulurken, o an zaten kaydedilmis
-- olan odeme satirinin package_id'si guncellenmiyordu — odeme, randevunun
-- sonradan bagladigi pakete hic baglanmamis (package_id NULL) kaliyordu. Bu
-- da paketin "hic odenmemis" gibi gorunmesine yol aciyordu (bildirildi,
-- kod tarafi da ayrica duzeltildi). Burada SADECE bu spesifik, kesin
-- tanimlanabilir durum onariliyor: odemenin appointment_id'si artik bir
-- package_id tasiyan bir randevuya isaret ediyor ama odemenin kendi
-- package_id'si hala bos.
UPDATE public.payments p
SET package_id = a.package_id
FROM public.appointments a
WHERE p.appointment_id = a.id
  AND p.package_id IS NULL
  AND a.package_id IS NOT NULL;
