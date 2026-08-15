-- Seans paketleri (ör. "8 seans epilasyon") ve gerçek ödeme kayıtları.
-- Paketin sabit bir toplam fiyatı yok — her seansın ücreti kendi hizmet
-- fiyatından gelir, indirim/kısmi ödeme payments.amount üzerinden yönetilir.
-- Bir randevu paketin parçası olabilir (appointments.package_id); bir ödeme
-- belirli bir randevuya, bir pakete, ikisine birden veya hiçbirine (serbest
-- tahsilat) bağlı olabilir — randevu tamamlanma anıyla ödeme anı kasıtlı
-- olarak birbirinden bağımsız (bazen bir sonraki seansta tahsil ediliyor).

CREATE TABLE IF NOT EXISTS public.service_packages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id        uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  service_id         uuid REFERENCES public.services(id) ON DELETE SET NULL,
  total_sessions     integer NOT NULL CHECK (total_sessions > 0),
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_service_packages_business_id ON public.service_packages (business_id);
CREATE INDEX idx_service_packages_customer_id ON public.service_packages (customer_id);

CREATE TRIGGER trg_service_packages_updated_at
  BEFORE UPDATE ON public.service_packages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.service_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_packages_select"
  ON public.service_packages FOR SELECT
  USING (business_id = public.my_business_id());

CREATE POLICY "service_packages_insert"
  ON public.service_packages FOR INSERT
  WITH CHECK (
    business_id = public.my_business_id()
    AND created_by_user_id = auth.uid()
  );

CREATE POLICY "service_packages_update_admin"
  ON public.service_packages FOR UPDATE
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'admin'
  );

CREATE POLICY "service_packages_update_user"
  ON public.service_packages FOR UPDATE
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'user'
    AND created_by_user_id = auth.uid()
  )
  WITH CHECK (
    business_id = public.my_business_id()
    AND created_by_user_id = auth.uid()
  );

CREATE POLICY "service_packages_delete_admin"
  ON public.service_packages FOR DELETE
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'admin'
  );

-- Randevu bir paketin seansı olabilir — hangi seans oldugu (ör. "3/8"),
-- paketteki randevular tarihe gore siralanarak hesaplanir, ayri bir
-- sutun tutulmaz.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS package_id uuid REFERENCES public.service_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_package_id ON public.appointments (package_id);

CREATE TABLE IF NOT EXISTS public.payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id        uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  appointment_id     uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  package_id         uuid REFERENCES public.service_packages(id) ON DELETE SET NULL,
  amount             numeric(10, 2) NOT NULL CHECK (amount >= 0),
  method             text NOT NULL DEFAULT 'nakit' CHECK (method IN ('nakit', 'kart', 'diger')),
  paid_at            date NOT NULL DEFAULT CURRENT_DATE,
  note               text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_business_id ON public.payments (business_id);
CREATE INDEX idx_payments_customer_id ON public.payments (customer_id);
CREATE INDEX idx_payments_appointment_id ON public.payments (appointment_id);
CREATE INDEX idx_payments_package_id ON public.payments (package_id);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments_select"
  ON public.payments FOR SELECT
  USING (business_id = public.my_business_id());

CREATE POLICY "payments_insert"
  ON public.payments FOR INSERT
  WITH CHECK (
    business_id = public.my_business_id()
    AND created_by_user_id = auth.uid()
  );

CREATE POLICY "payments_update_admin"
  ON public.payments FOR UPDATE
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'admin'
  );

CREATE POLICY "payments_update_user"
  ON public.payments FOR UPDATE
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'user'
    AND created_by_user_id = auth.uid()
  )
  WITH CHECK (
    business_id = public.my_business_id()
    AND created_by_user_id = auth.uid()
  );

CREATE POLICY "payments_delete_admin"
  ON public.payments FOR DELETE
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'admin'
  );
