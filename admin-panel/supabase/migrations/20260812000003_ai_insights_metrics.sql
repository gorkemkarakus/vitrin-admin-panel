-- AI Is Analizi sayfasina gercek grafikler (ciro/gider/net kar cubugu,
-- musteri segment donut'u, gelmedi/iptal orani) eklemek icin — bu sayilar
-- generate-ai-insights edge function'inda zaten hesaplaniyordu ama sadece
-- OpenAI prompt'una gidip kayboluyordu, hicbir yerde saklanmiyordu.
ALTER TABLE public.business_ai_insights
  ADD COLUMN IF NOT EXISTS metrics jsonb NOT NULL DEFAULT '{}';
