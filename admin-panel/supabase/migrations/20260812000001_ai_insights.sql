-- AI İş Analizi (roadmap F) — işletmenin kendi ciro/gider/CRM/reklam
-- verisinden OpenAI'ın ürettiği son rapor, tek satır (işletme başına),
-- "Analiz Oluştur" butonuyla talep üzerine üretilir, cron YOK.
-- ad_insight_snapshots ile AYNI RLS deseni: SELECT-only admin+own business,
-- client INSERT/UPDATE/DELETE policy YOK — sadece service_role (edge
-- function) yazar.
CREATE TABLE IF NOT EXISTS public.business_ai_insights (
  business_id     uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  generated_at    timestamptz NOT NULL,
  summary         text NOT NULL,
  highlights      jsonb NOT NULL DEFAULT '[]',
  risks           jsonb NOT NULL DEFAULT '[]',
  recommendations jsonb NOT NULL DEFAULT '[]',
  model           text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_ai_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_ai_insights_select_admin"
  ON public.business_ai_insights FOR SELECT
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  );
