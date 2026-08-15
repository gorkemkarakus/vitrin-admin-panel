-- =============================================================================
-- Meta (Facebook) reklam verisi gösterimi — işletme sahibi kendi reklam
-- hesabını bağlayıp harcama/gösterim/tıklama/dönüşüm/ROAS verilerini görebilir.
-- AI yorum katmanı YOK (kullanıcı bilerek erteledi — sadece ham veri).
--
-- Güvenlik tasarımı, mevcut iki desenin birleşimi:
--   1. business_finance_settings/business_expenses'teki my_role()+my_business_id()
--      RLS deseni (tenant izolasyonu).
--   2. api_key_hash'teki kolon-seviyesi REVOKE deseni (hassas token, admin
--      rolü bile PostgREST üzerinden okuyamaz — sadece service_role).
-- business_ad_connections'a HİÇBİR client INSERT/UPDATE/DELETE policy'si
-- yok (sadece SELECT) — bağlanma/kopma/token yenileme akışlarının HEPSİ
-- requireAdmin ile korunan edge function'lardan geçmek ZORUNDA, ham bir
-- PostgREST INSERT/UPDATE ile bypass edilemez.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.business_ad_connections (
  business_id             uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider                text NOT NULL DEFAULT 'meta' CHECK (provider = 'meta'),
  status                  text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'connected', 'error')),
  ad_account_id           text,
  ad_account_name         text,
  encrypted_access_token  text,
  token_expires_at        timestamptz,
  last_synced_at          timestamptz,
  last_error              text,
  connected_by            uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  connected_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_business_ad_connections_updated_at
  BEFORE UPDATE ON public.business_ad_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.business_ad_connections ENABLE ROW LEVEL SECURITY;

-- İşletme sahibi kendi bağlantı durumunu (bağlı mı, hangi hesap, ne zaman
-- senkronlandı) görebilir — ama yazamaz, sadece service_role yazar.
CREATE POLICY "business_ad_connections_select_admin"
  ON public.business_ad_connections FOR SELECT
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  );

-- encrypted_access_token, admin'in SELECT hakkı olsa bile PostgREST'ten asla
-- görünmez — api_key_hash ile BİREBİR AYNI kilit (20260725000007).
REVOKE SELECT (encrypted_access_token), INSERT (encrypted_access_token),
  UPDATE (encrypted_access_token), REFERENCES (encrypted_access_token)
  ON public.business_ad_connections FROM anon, authenticated;

CREATE INDEX idx_business_ad_connections_status ON public.business_ad_connections (status)
  WHERE status = 'connected';

-- ── ad_insight_snapshots — Meta'dan çekilen ham metrikler, işletme+aralık
--    başına önbelleklenmiş tek satır (cron veya isteğe bağlı yenilemeyle
--    upsert edilir) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ad_insight_snapshots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  range_days     smallint NOT NULL CHECK (range_days IN (7, 30)),
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  spend          numeric(12, 2),
  impressions    bigint,
  clicks         bigint,
  conversions    numeric(12, 2),
  roas           numeric(8, 2),
  generated_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, range_days)
);

CREATE INDEX idx_ad_insight_snapshots_business ON public.ad_insight_snapshots (business_id);

ALTER TABLE public.ad_insight_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ad_insight_snapshots_select_admin"
  ON public.ad_insight_snapshots FOR SELECT
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  );
-- Buraya da client INSERT/UPDATE/DELETE policy'si YOK — sadece service_role.

-- ── Periyodik işler ──────────────────────────────────────────────────────
-- appointment_webhook_secret'ı YENİDEN KULLANMAK yerine ayrı bir secret
-- tercih edildi (blast-radius izolasyonu — bu ikisinin sızması randevu
-- hatırlatma sistemini etkilemesin). DEĞER bu dosyada YOK; appointment
-- webhook secret'ıyla aynı desen (_app_secrets satırı + eşleşen
-- META_ADS_WEBHOOK_SECRET edge function secret'ı) kullanıcı tarafından
-- elle, migration sonrası tek seferlik olarak girilecek.
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'refresh-ad-tokens',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllvmyriopaulcmmynbe.supabase.co/functions/v1/refresh-ad-tokens',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (SELECT value FROM public._app_secrets WHERE name = 'meta_ads_webhook_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'sync-ad-insights',
  '0 5 * * *',
  $$
  SELECT net.http_post(
    url := 'https://rllvmyriopaulcmmynbe.supabase.co/functions/v1/sync-ad-insights',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (SELECT value FROM public._app_secrets WHERE name = 'meta_ads_webhook_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
