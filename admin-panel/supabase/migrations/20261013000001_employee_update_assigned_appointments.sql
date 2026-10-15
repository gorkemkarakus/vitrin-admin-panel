-- Calisan (role='user') simdiye kadar SADECE kendi olusturdugu
-- (created_by_user_id = kendisi) randevulari guncelleyebiliyordu. Chatbot,
-- online randevu sayfasi ya da yoneticinin o calisana actigi randevularda
-- created_by_user_id baska biri (veya NULL) oldugu icin calisan kendi
-- musterisini "tamamlandi"/"gelmedi" yapamiyor, odeme alamiyordu.
--
-- Bu politika, calisana KENDISINE ATANMIS (employee_id = kendisi) randevulari
-- da guncelleme izni verir. WITH CHECK randevunun yine ona atanmis kalmasini
-- sart kosar — calisan randevuyu baskasina devredemez/baska isletmeye tasiyamaz.
-- Mevcut appointments_update_user politikasi aynen kalir (PostgreSQL ayni
-- komut icin politikalari OR ile birlestirir).
DROP POLICY IF EXISTS "appointments_update_assigned" ON public.appointments;

CREATE POLICY "appointments_update_assigned"
  ON public.appointments FOR UPDATE
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'user'
    AND employee_id = auth.uid()
  )
  WITH CHECK (
    business_id = public.my_business_id()
    AND employee_id = auth.uid()
  );
