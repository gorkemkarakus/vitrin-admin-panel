-- =============================================================================
-- employee_commission_rates — çalışan prim oranları (admin-only, ayrı tablo)
-- =============================================================================
-- profiles tablosuna eklenmedi çünkü profiles_select politikası işletmedeki
-- HERKESİN tüm profil sütunlarını okumasına izin veriyor (row-level, column-level
-- değil) — prim oranı gibi maaş-benzeri bir alan bu şekilde herkese açık olurdu.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.employee_commission_rates (
  profile_id     uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  commission_pct numeric(5, 2) NOT NULL DEFAULT 0 CHECK (commission_pct >= 0 AND commission_pct <= 100),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_employee_commission_rates_updated_at
  BEFORE UPDATE ON public.employee_commission_rates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.employee_commission_rates ENABLE ROW LEVEL SECURITY;

-- Sadece admin, kendi işletmesindeki çalışanların prim oranını okuyabilir/yazabilir.
CREATE POLICY "employee_commission_rates_admin_all"
  ON public.employee_commission_rates FOR ALL
  USING (
    public.my_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_commission_rates.profile_id
        AND p.business_id = public.my_business_id()
    )
  )
  WITH CHECK (
    public.my_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_commission_rates.profile_id
        AND p.business_id = public.my_business_id()
    )
  );
