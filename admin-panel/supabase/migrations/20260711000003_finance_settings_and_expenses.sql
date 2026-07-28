-- =============================================================================
-- business_commission_rate artık sadece prim değil, vergi oranını da tutuyor
-- (ikisi de işletme geneli tek değer) — daha genel bir isimle yeniden kuruluyor.
-- Ayrıca işletme giderlerini kaydetmek için business_expenses tablosu.
-- =============================================================================

DROP TABLE IF EXISTS public.business_commission_rate;

CREATE TABLE IF NOT EXISTS public.business_finance_settings (
  business_id    uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  commission_pct numeric(5, 2) NOT NULL DEFAULT 0 CHECK (commission_pct >= 0 AND commission_pct <= 100),
  tax_pct        numeric(5, 2) NOT NULL DEFAULT 0 CHECK (tax_pct >= 0 AND tax_pct <= 100),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_business_finance_settings_updated_at
  BEFORE UPDATE ON public.business_finance_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.business_finance_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_finance_settings_admin_all"
  ON public.business_finance_settings FOR ALL
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  )
  WITH CHECK (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  );

-- ── business_expenses — işletme giderleri (kira, fatura, sarf malzeme vb.) ──
CREATE TABLE IF NOT EXISTS public.business_expenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  description  text NOT NULL,
  amount       numeric(10, 2) NOT NULL CHECK (amount >= 0),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_business_expenses_business_id ON public.business_expenses (business_id);
CREATE INDEX idx_business_expenses_date ON public.business_expenses (expense_date);

CREATE TRIGGER trg_business_expenses_updated_at
  BEFORE UPDATE ON public.business_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.business_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_expenses_admin_all"
  ON public.business_expenses FOR ALL
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  )
  WITH CHECK (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  );
