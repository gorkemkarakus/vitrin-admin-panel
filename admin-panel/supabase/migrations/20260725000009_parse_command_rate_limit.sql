-- Guvenlik denetimi bulgusu: parse-appointment-command gecerli bir kullanici
-- oturumu gerektiriyor ama her cagrida gercek paraya mal olan bir OpenAI
-- istegi tetikliyor ve staff_whatsapp_attempts/public_booking_attempts'in
-- aksine HICBIR rate-limit'i yoktu — bozuk bir frontend dongusu veya kotuye
-- kullanilan bir personel hesabi sinirsiz OpenAI maliyeti olusturabilirdi.
CREATE TABLE IF NOT EXISTS public.parse_command_attempts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_parse_command_attempts_user_time
  ON public.parse_command_attempts (user_id, created_at);

-- staff_whatsapp_attempts/public_booking_attempts ile ayni desen — RLS acik,
-- client policy yok, sadece service_role yazip okuyabilir.
ALTER TABLE public.parse_command_attempts ENABLE ROW LEVEL SECURITY;
