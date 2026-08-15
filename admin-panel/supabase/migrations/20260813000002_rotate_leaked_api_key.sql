-- Guvenlik denetimi bulgusu: businesses.api_key_hash'in ait oldugu duz-metin
-- API anahtari, n8n/flows/*.json dosyalarinda ilk commit'ten beri git
-- gecmisinde ve GitHub origin/main'de yayinda kalmis. Bu anahtari bilen
-- herkes book-appointment/cancel-appointment/reschedule-appointment/
-- chatbot-context/chatbot-log-message/public-book-appointment/
-- staff-whatsapp-webhook gibi x-api-key korumali uclara bu isletme kimligiyle
-- istek atabilirdi. Eski anahtar burada rotate ediliyor (yeni duz-metin
-- anahtar n8n flow dosyalarina ayrica yaziliyor, DB'de sadece hash tutuluyor).
UPDATE public.businesses
SET api_key_hash = 'fdd1a9ca6751879d0612d152658d1b3739c28e598c3d91706a4af31a8b3a55e2'
WHERE api_key_hash = '635941fa9bd5d108906034da2c770fc7a9a29fea75afcacf082c8056e69e1f75';
