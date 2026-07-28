-- =============================================================================
-- businesses.slug zaten vardı (UNIQUE, nullable, ilk şemadan beri) ama hiç
-- zorunlu kılınmamış/otomatik üretilmemişti. Herkese açık randevu sayfası
-- (/randevu-al/{slug}) için her işletmenin bir slug'a sahip olması gerekiyor.
-- =============================================================================

-- ── Türkçe karakterleri katlayıp URL-güvenli bir slug üreten fonksiyon ──────
-- translate() lower()'DAN ÖNCE çalışır: 'İ' harfini önce düz ASCII 'I'ya
-- çevirip SONRA lower() çağırıyoruz — aksi sırada lower('İ') varsayılan
-- collation'da sondaki noktayı ayrı bir birleşen karaktere ('i̇') dönüştürür,
-- bu da slug'ı bozar.
CREATE OR REPLACE FUNCTION public.tr_slugify(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' from
    regexp_replace(
      lower(translate(input, 'ÇçŞşĞğÜüÖöİı', 'CcSsGgUuOoIi')),
      '[^a-z0-9]+', '-', 'g'
    )
  )
$$;

-- ── Mevcut slug'ı olmayan işletmeleri doldur (çakışma varsa -2, -3 ... ekle) ─
DO $$
DECLARE
  biz record;
  candidate text;
  suffix int;
BEGIN
  FOR biz IN SELECT id, name FROM public.businesses WHERE slug IS NULL ORDER BY created_at LOOP
    candidate := public.tr_slugify(biz.name);
    IF candidate = '' THEN candidate := 'isletme'; END IF;
    suffix := 1;
    WHILE EXISTS (SELECT 1 FROM public.businesses WHERE slug = candidate) LOOP
      suffix := suffix + 1;
      candidate := public.tr_slugify(biz.name) || '-' || suffix::text;
    END LOOP;
    UPDATE public.businesses SET slug = candidate WHERE id = biz.id;
  END LOOP;
END $$;

ALTER TABLE public.businesses ALTER COLUMN slug SET NOT NULL;

-- ── İleride elle eklenecek işletmeler için otomatik slug üretimi ───────────
CREATE OR REPLACE FUNCTION public.set_business_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
  suffix int := 1;
BEGIN
  IF new.slug IS NOT NULL AND new.slug <> '' THEN
    RETURN new;
  END IF;
  candidate := public.tr_slugify(new.name);
  IF candidate = '' THEN candidate := 'isletme'; END IF;
  WHILE EXISTS (SELECT 1 FROM public.businesses WHERE slug = candidate) LOOP
    suffix := suffix + 1;
    candidate := public.tr_slugify(new.name) || '-' || suffix::text;
  END LOOP;
  new.slug := candidate;
  RETURN new;
END;
$$;

CREATE TRIGGER trg_businesses_set_slug
  BEFORE INSERT ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public.set_business_slug();
