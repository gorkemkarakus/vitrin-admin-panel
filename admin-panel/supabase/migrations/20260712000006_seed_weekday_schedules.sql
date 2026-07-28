-- Güzel Salon'daki aktif çalışanların çoğu günde hiç mesai kaydı yoktu
-- (public randevu sayfası testinde çoğu tarihte "uygun saat yok" çıkıyordu).
-- Tüm aktif çalışanlara hafta içi (Pzt-Cum, day_of_week 1-5) 09:00-16:00
-- tam mesai yaz; önce eskiyi temizle ki eksik/çakışan satır kalmasın.
DELETE FROM public.employee_schedules
WHERE profile_id IN (
  SELECT id FROM public.profiles
  WHERE business_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND is_active = true
);

INSERT INTO public.employee_schedules (profile_id, day_of_week, starts_at, ends_at)
SELECT p.id, d.day_of_week, '09:00', '16:00'
FROM public.profiles p
CROSS JOIN (SELECT unnest(ARRAY[1,2,3,4,5]) AS day_of_week) d
WHERE p.business_id = 'aaaaaaaa-0000-0000-0000-000000000001' AND p.is_active = true;
