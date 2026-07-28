-- =============================================================================
-- Alan (kategori) bazlı hizmet + çalışan planlaması.
-- Örn: "Tırnak", "Kuaför", "Cilt Bakımı" — her hizmet bir alana, her çalışan bir
-- veya birden fazla alana atanır. Randevu artık belirli bir çalışana bağlanır.
-- =============================================================================

CREATE TABLE public.service_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_categories_business_id ON public.service_categories (business_id);

ALTER TABLE public.services
  ADD COLUMN category_id uuid REFERENCES public.service_categories(id) ON DELETE SET NULL;

-- Bir çalışan birden fazla alanda çalışabilir (çoka-çok).
CREATE TABLE public.employee_categories (
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.service_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (profile_id, category_id)
);

-- Çalışanın haftalık çalışma saatleri.
-- day_of_week: Postgres EXTRACT(DOW) ile aynı kural — 0=Pazar ... 6=Cumartesi.
CREATE TABLE public.employee_schedules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  starts_at   time NOT NULL,
  ends_at     time NOT NULL,
  CHECK (ends_at > starts_at)
);

CREATE INDEX idx_employee_schedules_profile_id ON public.employee_schedules (profile_id);

-- Randevu hangi çalışana atanmış.
ALTER TABLE public.appointments
  ADD COLUMN employee_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX idx_appointments_employee_id_new ON public.appointments (employee_id);

-- =============================================================================
-- RLS: yeni tablolar
-- =============================================================================
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_categories_select"
  ON public.service_categories FOR SELECT
  USING (business_id = public.my_business_id());

CREATE POLICY "service_categories_write_admin"
  ON public.service_categories FOR ALL
  USING (business_id = public.my_business_id() AND public.my_role() = 'admin')
  WITH CHECK (business_id = public.my_business_id() AND public.my_role() = 'admin');

-- employee_categories / employee_schedules: business_id'leri yok, profiles
-- üzerinden dolaylı olarak işletmeye bağlanıyorlar.
CREATE POLICY "employee_categories_select"
  ON public.employee_categories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_categories.profile_id
        AND p.business_id = public.my_business_id()
    )
  );

CREATE POLICY "employee_categories_write_admin"
  ON public.employee_categories FOR ALL
  USING (
    public.my_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_categories.profile_id
        AND p.business_id = public.my_business_id()
    )
  )
  WITH CHECK (
    public.my_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_categories.profile_id
        AND p.business_id = public.my_business_id()
    )
  );

CREATE POLICY "employee_schedules_select"
  ON public.employee_schedules FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_schedules.profile_id
        AND p.business_id = public.my_business_id()
    )
  );

CREATE POLICY "employee_schedules_write_admin"
  ON public.employee_schedules FOR ALL
  USING (
    public.my_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_schedules.profile_id
        AND p.business_id = public.my_business_id()
    )
  )
  WITH CHECK (
    public.my_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_schedules.profile_id
        AND p.business_id = public.my_business_id()
    )
  );

-- =============================================================================
-- Çakışma engeli: aynı çalışan aynı saat aralığında iki randevuda birden
-- olamaz. Bu kontrol veritabanı seviyesinde — sadece arayüzde değil, ileride
-- n8n chatbot doğrudan INSERT atsa bile bu trigger devreye girer.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.check_employee_appointment_conflict()
RETURNS trigger AS $$
DECLARE
  new_end timestamptz;
  conflict_count int;
BEGIN
  IF NEW.status = 'iptal' OR NEW.employee_id IS NULL THEN
    RETURN NEW;
  END IF;

  new_end := NEW.scheduled_at + make_interval(mins => COALESCE(NEW.duration_minutes, 30));

  SELECT count(*) INTO conflict_count
  FROM public.appointments a
  WHERE a.employee_id = NEW.employee_id
    AND a.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND a.status <> 'iptal'
    AND a.scheduled_at < new_end
    AND (a.scheduled_at + make_interval(mins => COALESCE(a.duration_minutes, 30))) > NEW.scheduled_at;

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'Bu çalışan bu saat aralığında zaten dolu.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_employee_conflict
BEFORE INSERT OR UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.check_employee_appointment_conflict();
