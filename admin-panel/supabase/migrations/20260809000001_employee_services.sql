-- =============================================================================
-- Kategori bazli calisan-hizmet eslestirmesi kaldiriliyor; calisanlar artik
-- dogrudan tek tek hizmetlerle (employee_services) eslestiriliyor. Her hizmet
-- ("islem") bagimsiz bir birim; kategori gruplamasi uygulama tarafinda
-- kullanilmiyor. employee_categories/service_categories/services.category_id
-- silinmiyor (geriye donuk veri kaybi riski almamak icin), sadece uygulama
-- kodu artik bunlari okumuyor/yazmiyor.
-- =============================================================================

CREATE TABLE public.employee_services (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, service_id)
);

ALTER TABLE public.employee_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_services_select"
  ON public.employee_services FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_services.profile_id
        AND p.business_id = public.my_business_id()
    )
  );

CREATE POLICY "employee_services_write_admin"
  ON public.employee_services FOR ALL
  USING (
    public.my_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_services.profile_id
        AND p.business_id = public.my_business_id()
    )
  )
  WITH CHECK (
    public.my_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_services.profile_id
        AND p.business_id = public.my_business_id()
    )
  );

-- Gecis: mevcut kategori atamalarini koru — bir calisan bir kategoriye
-- atanmissa, o kategorideki tum hizmetlere de atanmis sayilsin (booking
-- davranisini bozmamak icin).
INSERT INTO public.employee_services (profile_id, service_id)
SELECT DISTINCT ec.profile_id, s.id
FROM public.employee_categories ec
JOIN public.services s ON s.category_id = ec.category_id
ON CONFLICT (profile_id, service_id) DO NOTHING;

-- Kategorisi olmayan hizmetler eskiden "herkes uygun" sayiliyordu (bkz.
-- eligibleEmployees fallback'i) — ayni davranisi korumak icin o hizmetleri
-- o isletmenin tum aktif calisanlarina aciliyoruz.
INSERT INTO public.employee_services (profile_id, service_id)
SELECT DISTINCT p.id, s.id
FROM public.services s
JOIN public.profiles p ON p.business_id = s.business_id AND p.is_active = true
WHERE s.category_id IS NULL
ON CONFLICT (profile_id, service_id) DO NOTHING;
