-- Chatbot kanalı (Instagram IGSID, vb.) bazen gerçek telefon numarası değildir.
-- Bilgilendirme/hatırlatma mesajları için müşterinin gerçek iletişim
-- numarasını ayrıca saklıyoruz.
ALTER TABLE public.customers ADD COLUMN contact_phone text;
