-- Gun sonu kasa kapanisi: o gunun tahsilati (yonteme gore), nakit giderler,
-- acilis kasasi ve sayilan nakit. Gunde bir kayit; tekrar sayilinca guncellenir.
CREATE TABLE IF NOT EXISTS public.cash_closures (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  closure_date  date NOT NULL,
  opening_cash  numeric(12, 2) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  counted_cash  numeric(12, 2) NOT NULL CHECK (counted_cash >= 0),
  expected_cash numeric(12, 2) NOT NULL,
  difference    numeric(12, 2) NOT NULL,
  -- Kapanis anindaki ozet (PDF'i sonradan ayni rakamlarla uretmek icin):
  -- { "nakit": 0, "kart": 0, "havale": 0, "diger": 0, "bakiye": 0,
  --   "cash_expense": 0, "completed": 0, "cancelled": 0, "no_show": 0, "unpaid": 0 }
  totals        jsonb NOT NULL DEFAULT '{}'::jsonb,
  note          text,
  closed_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, closure_date)
);

CREATE INDEX IF NOT EXISTS idx_cash_closures_business_date ON public.cash_closures (business_id, closure_date DESC);

DROP TRIGGER IF EXISTS trg_cash_closures_updated_at ON public.cash_closures;
CREATE TRIGGER trg_cash_closures_updated_at
  BEFORE UPDATE ON public.cash_closures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.cash_closures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_closures FROM anon;

-- Kasa yetkisi olan okur/kapatir; silmek yalnizca yonetici.
DROP POLICY IF EXISTS "cash_closures_select" ON public.cash_closures;
CREATE POLICY "cash_closures_select"
  ON public.cash_closures FOR SELECT
  USING (business_id = public.my_business_id() AND (SELECT public.has_perm('kasa')));

DROP POLICY IF EXISTS "cash_closures_insert" ON public.cash_closures;
CREATE POLICY "cash_closures_insert"
  ON public.cash_closures FOR INSERT
  WITH CHECK (business_id = public.my_business_id() AND (SELECT public.has_perm('kasa')) AND closed_by = auth.uid());

DROP POLICY IF EXISTS "cash_closures_update" ON public.cash_closures;
CREATE POLICY "cash_closures_update"
  ON public.cash_closures FOR UPDATE
  USING (business_id = public.my_business_id() AND (SELECT public.has_perm('kasa')))
  WITH CHECK (business_id = public.my_business_id() AND closed_by = auth.uid());

DROP POLICY IF EXISTS "cash_closures_delete" ON public.cash_closures;
CREATE POLICY "cash_closures_delete"
  ON public.cash_closures FOR DELETE
  USING (business_id = public.my_business_id() AND public.my_role() = 'admin');

NOTIFY pgrst, 'reload schema';
