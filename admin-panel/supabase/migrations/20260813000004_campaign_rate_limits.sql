-- Guvenlik denetimi bulgusu: send-bulk-campaign (MAX_RECIPIENTS=500 disinda)
-- ve generate-campaign-message (OpenAI cagrisi tetikliyor) hicbir hiz
-- sinirlamasina sahip degildi — staff_whatsapp_attempts/parse_command_attempts
-- ile AYNI desen, isletme basina saatlik limit icin.
CREATE TABLE IF NOT EXISTS public.bulk_campaign_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bulk_campaign_attempts_business_time
  ON public.bulk_campaign_attempts (business_id, created_at);
ALTER TABLE public.bulk_campaign_attempts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.campaign_message_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaign_message_attempts_business_time
  ON public.campaign_message_attempts (business_id, created_at);
ALTER TABLE public.campaign_message_attempts ENABLE ROW LEVEL SECURITY;
