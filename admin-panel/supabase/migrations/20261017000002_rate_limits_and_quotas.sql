-- Herkese acik uc noktalar icin genel hiz siniri ve maliyet doguran
-- islemler (AI, toplu mesaj) icin isletme basi gunluk kota.
-- Ikisi de yalnizca edge function'lardan (service role) cagrilir.

-- Hiz siniri: kova + konu (ör. IP ozeti) basina kayan pencere.
CREATE TABLE IF NOT EXISTS public.rate_limit_hits (
  id bigserial PRIMARY KEY,
  bucket text NOT NULL,
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_limit_hits_lookup ON public.rate_limit_hits (bucket, subject, created_at);
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_hits FROM anon, authenticated;

-- true: istek kabul edildi (ve sayildi); false: sinir asildi.
CREATE OR REPLACE FUNCTION public.hit_rate_limit(p_bucket text, p_subject text, p_limit int, p_window_seconds int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  -- Ayni kova+konu icin es zamanli istekler sirayla sayilir.
  PERFORM pg_advisory_xact_lock(hashtext(p_bucket || ':' || p_subject));
  DELETE FROM public.rate_limit_hits
  WHERE bucket = p_bucket AND created_at < now() - make_interval(secs => p_window_seconds);
  SELECT count(*) INTO n FROM public.rate_limit_hits
  WHERE bucket = p_bucket AND subject = p_subject AND created_at >= now() - make_interval(secs => p_window_seconds);
  IF n >= p_limit THEN
    RETURN false;
  END IF;
  INSERT INTO public.rate_limit_hits (bucket, subject) VALUES (p_bucket, p_subject);
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.hit_rate_limit(text, text, int, int) FROM PUBLIC, anon, authenticated;

-- Gunluk kullanim: isletme + tur + gun (Europe/Istanbul).
CREATE TABLE IF NOT EXISTS public.business_usage_daily (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  kind text NOT NULL,
  day date NOT NULL,
  used int NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (business_id, kind, day)
);
ALTER TABLE public.business_usage_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.business_usage_daily FROM anon, authenticated;

-- p_amount kadar kota ayirir; gunluk sinir asilacaksa hicbir sey ayirmaz ve
-- false doner. Kontrol ve ayirma tek UPDATE'te oldugu icin es zamanli
-- istekler sinira birlikte asamaz.
CREATE OR REPLACE FUNCTION public.consume_quota(p_business uuid, p_kind text, p_limit int, p_amount int DEFAULT 1)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d date := (now() AT TIME ZONE 'Europe/Istanbul')::date;
  ok boolean;
BEGIN
  INSERT INTO public.business_usage_daily (business_id, kind, day) VALUES (p_business, p_kind, d)
  ON CONFLICT DO NOTHING;
  UPDATE public.business_usage_daily
  SET used = used + p_amount
  WHERE business_id = p_business AND kind = p_kind AND day = d AND used + p_amount <= p_limit
  RETURNING true INTO ok;
  RETURN coalesce(ok, false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.consume_quota(uuid, text, int, int) FROM PUBLIC, anon, authenticated;
