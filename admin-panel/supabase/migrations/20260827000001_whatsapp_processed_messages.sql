-- WhatsApp Cloud API Gorev 2: Meta ayni webhook olayini birden fazla kez
-- gonderebiliyor (retry/at-least-once teslimat) — wamid (mesaj id'si) burada
-- saklanip ayni id ikinci kez geldiginde islenmeden atlaniyor. Insert'in
-- PRIMARY KEY ihlaliyle basarisiz olmasi "zaten islendi" sinyali olarak
-- kullaniliyor (check-then-insert yerine atomic insert-veya-cakis deseni,
-- yaris durumuna acik degil).
CREATE TABLE IF NOT EXISTS public.whatsapp_processed_messages (
  wamid      text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_processed_messages ENABLE ROW LEVEL SECURITY;
