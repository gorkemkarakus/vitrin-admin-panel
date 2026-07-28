-- =============================================================================
-- employee_commission_rates yerine tek, işletme geneli prim oranına geçiş.
-- (Kullanıcı isteği: çalışan bazlı değil, işletmede genel tek bir prim %.)
-- =============================================================================

DROP TABLE IF EXISTS public.employee_commission_rates;

CREATE TABLE IF NOT EXISTS public.business_commission_rate (
  business_id    uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  commission_pct numeric(5, 2) NOT NULL DEFAULT 0 CHECK (commission_pct >= 0 AND commission_pct <= 100),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_business_commission_rate_updated_at
  BEFORE UPDATE ON public.business_commission_rate
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.business_commission_rate ENABLE ROW LEVEL SECURITY;

-- Sadece admin, kendi işletmesinin prim oranını okuyabilir/yazabilir.
CREATE POLICY "business_commission_rate_admin_all"
  ON public.business_commission_rate FOR ALL
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  )
  WITH CHECK (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  );
