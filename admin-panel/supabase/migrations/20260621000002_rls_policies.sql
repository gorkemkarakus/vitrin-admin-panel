-- =============================================================================
-- VİTRİN — RLS Politikaları
-- Çalıştırma: 20260621000001_initial_schema.sql'den SONRA çalıştır
-- =============================================================================

-- ── RLS'i tüm tablolarda etkinleştir ─────────────────────────────────────
ALTER TABLE public.businesses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- businesses
-- Kullanıcı sadece kendi işletmesini görebilir.
-- INSERT/UPDATE/DELETE: sadece service_role (biz operatör olarak yaparız).
-- =============================================================================
CREATE POLICY "businesses_select_own"
  ON public.businesses FOR SELECT
  USING (id = public.my_business_id());

-- =============================================================================
-- profiles
-- SELECT: tüm aktif kullanıcılar kendi işletmesindeki profilleri görebilir
--         (ekip listesi, randevu sahibi adı vb. için).
-- INSERT: sadece admin — yeni kullanıcı oluşturma Edge Function'da yapılır.
-- UPDATE: admin herhangi bir profili; user yalnızca kendini güncelleyebilir.
-- DELETE: sadece admin.
-- =============================================================================
CREATE POLICY "profiles_select"
  ON public.profiles FOR SELECT
  USING (business_id = public.my_business_id());

CREATE POLICY "profiles_insert_admin"
  ON public.profiles FOR INSERT
  WITH CHECK (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  );

CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
  );

CREATE POLICY "profiles_update_self"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Kullanıcı kendi role veya business_id'sini değiştiremez
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
    AND business_id = (SELECT business_id FROM public.profiles WHERE id = auth.uid())
  );

CREATE POLICY "profiles_delete_admin"
  ON public.profiles FOR DELETE
  USING (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
    -- Admin kendi hesabını silemez
    AND id <> auth.uid()
  );

-- =============================================================================
-- customers
-- Aynı işletmedeki tüm kullanıcılar okuyabilir ve oluşturabilir.
-- Silme sadece admin.
-- =============================================================================
CREATE POLICY "customers_select"
  ON public.customers FOR SELECT
  USING (business_id = public.my_business_id());

CREATE POLICY "customers_insert"
  ON public.customers FOR INSERT
  WITH CHECK (business_id = public.my_business_id());

CREATE POLICY "customers_update"
  ON public.customers FOR UPDATE
  USING (business_id = public.my_business_id());

CREATE POLICY "customers_delete_admin"
  ON public.customers FOR DELETE
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'admin'
  );

-- =============================================================================
-- services
-- Tüm kullanıcılar görebilir; sadece admin ekleyip düzenleyebilir.
-- =============================================================================
CREATE POLICY "services_select"
  ON public.services FOR SELECT
  USING (business_id = public.my_business_id());

CREATE POLICY "services_insert_admin"
  ON public.services FOR INSERT
  WITH CHECK (
    business_id = public.my_business_id()
    AND public.my_role() = 'admin'
  );

CREATE POLICY "services_update_admin"
  ON public.services FOR UPDATE
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'admin'
  );

CREATE POLICY "services_delete_admin"
  ON public.services FOR DELETE
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'admin'
  );

-- =============================================================================
-- appointments
-- Admin: kendi işletmesindeki TÜM randevuları görebilir/düzenleyebilir.
-- User: sadece kendi oluşturduğu randevuları görebilir/düzenleyebilir.
-- INSERT: her kullanıcı oluşturabilir — ama created_by_user_id kendi UID'i olmak ZORUNDA.
-- DELETE: sadece admin.
-- =============================================================================
CREATE POLICY "appointments_select_admin"
  ON public.appointments FOR SELECT
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'admin'
  );

CREATE POLICY "appointments_select_user"
  ON public.appointments FOR SELECT
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'user'
    AND created_by_user_id = auth.uid()
  );

CREATE POLICY "appointments_insert"
  ON public.appointments FOR INSERT
  WITH CHECK (
    business_id = public.my_business_id()
    -- created_by_user_id'yi sahte yazamazsın
    AND created_by_user_id = auth.uid()
  );

CREATE POLICY "appointments_update_admin"
  ON public.appointments FOR UPDATE
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'admin'
  );

CREATE POLICY "appointments_update_user"
  ON public.appointments FOR UPDATE
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'user'
    AND created_by_user_id = auth.uid()
  )
  WITH CHECK (
    business_id = public.my_business_id()
    AND created_by_user_id = auth.uid()
  );

CREATE POLICY "appointments_delete_admin"
  ON public.appointments FOR DELETE
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'admin'
  );
