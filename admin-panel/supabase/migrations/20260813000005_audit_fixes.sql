-- Production-oncesi denetim (AUDIT.md) bulgulari:

-- 1) services.price/duration_minutes'ta DB-seviyesi CHECK yoktu — projedeki
-- diger parasal alanlarin (business_expenses.amount, payments.amount,
-- employee_commission_rates.commission_pct) hepsinde CHECK varken burada
-- unutulmustu. Negatif fiyat/sure DB'ye yazilabilirdi (ciro/komisyon
-- hesaplarina sessizce karisir).
ALTER TABLE public.services
  ADD CONSTRAINT services_price_check CHECK (price IS NULL OR price >= 0),
  ADD CONSTRAINT services_duration_check CHECK (duration_minutes > 0);

-- 2) customer_group_members RLS'i sadece kendi business_id kolonunu
-- kontrol ediyordu; group_id/customer_id'nin GERCEKTEN ayni isletmeye ait
-- oldugunu dogrulayan EXISTS kontrolu (employee_schedules/employee_services
-- gibi diger tablolarda zaten kullanilan desen) eksikti.
DROP POLICY IF EXISTS "customer_group_members_admin_all" ON public.customer_group_members;

CREATE POLICY "customer_group_members_admin_all"
  ON public.customer_group_members FOR ALL
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
    AND EXISTS (
      SELECT 1 FROM public.customer_groups g
      WHERE g.id = customer_group_members.group_id AND g.business_id = public.my_business_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_group_members.customer_id AND c.business_id = public.my_business_id()
    )
  )
  WITH CHECK (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
    AND EXISTS (
      SELECT 1 FROM public.customer_groups g
      WHERE g.id = customer_group_members.group_id AND g.business_id = public.my_business_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.customers c
      WHERE c.id = customer_group_members.customer_id AND c.business_id = public.my_business_id()
    )
  );
