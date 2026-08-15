-- Gider eklerken "tek seferlik mi aylık mı" ayrımı — otomatik tekrar/gelecek
-- ay için satır oluşturma YOK, sadece kaydın türünü etiketlemek için.
ALTER TABLE public.business_expenses ADD COLUMN IF NOT EXISTS is_recurring boolean NOT NULL DEFAULT false;
