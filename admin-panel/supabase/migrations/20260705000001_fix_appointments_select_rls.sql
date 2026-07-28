-- =============================================================================
-- DÜZELTME: appointments SELECT görünürlüğü
-- Önceki kural "user sadece kendi randevusunu görür" çakışan randevulara yol
-- açıyordu (bir çalışan başka bir çalışanın aldığı saati göremediği için aynı
-- saate ikinci bir randevu verebiliyordu). Takvim/slot görünürlüğü ile
-- atıf (kim oluşturdu — performans tablosu için) birbirinden ayrılmalı:
-- görünürlük işletme geneli olmalı, atıf created_by_user_id alanında zaten duruyor.
-- Düzenleme/iptal yetkisi ayrı kalıyor (appointments_update_user değişmedi).
-- =============================================================================

DROP POLICY IF EXISTS "appointments_select_admin" ON public.appointments;
DROP POLICY IF EXISTS "appointments_select_user"  ON public.appointments;

CREATE POLICY "appointments_select"
  ON public.appointments FOR SELECT
  USING (business_id = public.my_business_id());
