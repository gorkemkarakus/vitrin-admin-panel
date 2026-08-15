-- Cok-isletmeli WhatsApp: her isletme kendi WhatsApp numarasini baglayacak.
-- Meta'nin webhook'u gelen mesajda HANGI numaraya geldigini
-- (metadata.phone_number_id) bildiriyor — bu, o mesajin hangi isletmeye ait
-- oldugunu bulmak icin kullanilacak. api_key_hash gibi hassas bir alan
-- oldugundan (isletme kimligini cozuyor) authenticated/anon'a hic
-- acilmiyor, sadece service_role (edge function'lar) erisir.
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id text UNIQUE;
