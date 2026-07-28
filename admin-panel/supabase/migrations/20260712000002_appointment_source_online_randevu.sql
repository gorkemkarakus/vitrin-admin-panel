-- appointments.source kısıtlamasına, herkese açık randevu sayfasından
-- (/randevu-al/{slug}) gelen randevuları ayırt etmek için 'online_randevu' ekle.
ALTER TABLE public.appointments DROP CONSTRAINT appointments_source_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_source_check
  CHECK (source IN (
    'reklam_instagram',
    'reklam_whatsapp',
    'kullanici_uzerinden',
    'dogrudan_musteri',
    'chatbot',
    'online_randevu',
    'diger'
  ));
