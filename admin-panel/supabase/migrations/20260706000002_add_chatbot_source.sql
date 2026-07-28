-- appointments.source kısıtlamasına 'chatbot' değerini ekle
ALTER TABLE public.appointments DROP CONSTRAINT appointments_source_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_source_check
  CHECK (source IN (
    'reklam_instagram',
    'reklam_whatsapp',
    'kullanici_uzerinden',
    'dogrudan_musteri',
    'chatbot',
    'diger'
  ));
