-- =============================================================================
-- Calisan yetkileri: yonetici her calisan hesabinin neleri gorup neye
-- mudahale edebilecegini tek tek secer.
-- =============================================================================
-- Rol yapisi ayni kalir (admin | user). admin her seyi yapar; 'user' icin
-- yetkiler employee_permissions tablosundan okunur. Satiri olmayan calisan
-- varsayilan yetkilere sahiptir — varsayilan, bu migration oncesindeki
-- calisan davranisiyla birebir ayni (mevcut hesaplar hicbir sey kaybetmez).
--
-- Yetkiler:
--   randevu_tumu_gor      diger calisanlarin randevularini gorur        (varsayilan: acik)
--   randevu_tumu_duzenle  baskasinin randevusunu duzenler/iptal eder    (kapali)
--   odeme_al              odeme kaydeder                                (acik)
--   kasa                  Kasa + giderleri gorur ve gider girer         (kapali)
--   raporlar              Performans raporunu gorur                     (kapali)
--   ekip_yonet            calisma saatleri, izinler, calisan-hizmet     (kapali)
--   hizmet_yonet          hizmet ekler/duzenler, fiyat degistirir       (kapali)
--   mesajlar              WhatsApp konusmalarini gorur                  (acik)
-- Hesap acma/silme, yetki verme, toplu mesaj, AI analiz ve reklam her
-- durumda yalnizca yoneticide kalir.

CREATE OR REPLACE FUNCTION public.default_employee_permissions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['randevu_tumu_gor', 'odeme_al', 'mesajlar']::text[]
$$;

CREATE OR REPLACE FUNCTION public.all_employee_permissions()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY[
    'randevu_tumu_gor', 'randevu_tumu_duzenle', 'odeme_al', 'kasa',
    'raporlar', 'ekip_yonet', 'hizmet_yonet', 'mesajlar'
  ]::text[]
$$;

CREATE TABLE IF NOT EXISTS public.employee_permissions (
  profile_id  uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  permissions text[] NOT NULL DEFAULT public.default_employee_permissions()
    CHECK (permissions <@ public.all_employee_permissions()),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_permissions_business ON public.employee_permissions (business_id);

DROP TRIGGER IF EXISTS trg_employee_permissions_updated_at ON public.employee_permissions;
CREATE TRIGGER trg_employee_permissions_updated_at
  BEFORE UPDATE ON public.employee_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.employee_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_permissions FROM anon;

-- Calisan kendi yetkilerini okuyabilir (uygulama ekranlari buna gore
-- acilir); yonetici isletmesindeki herkesinkini okur ve yazar. Calisan
-- kendine yetki VEREMEZ (yazma yalnizca yoneticide).
DROP POLICY IF EXISTS "employee_permissions_select" ON public.employee_permissions;
CREATE POLICY "employee_permissions_select"
  ON public.employee_permissions FOR SELECT
  USING (
    business_id = public.my_business_id()
    AND (profile_id = auth.uid() OR public.my_role() = 'admin')
  );

DROP POLICY IF EXISTS "employee_permissions_admin_write" ON public.employee_permissions;
CREATE POLICY "employee_permissions_admin_write"
  ON public.employee_permissions FOR ALL
  USING (public.my_role() = 'admin' AND business_id = public.my_business_id())
  WITH CHECK (
    public.my_role() = 'admin'
    AND business_id = public.my_business_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_permissions.profile_id AND p.business_id = public.my_business_id()
    )
  );

-- Oturumdaki kullanicinin yetkisi var mi? RLS politikalarinda
-- "(SELECT public.has_perm('x'))" diye cagrilir (satir basina degil, sorgu
-- basina bir kez hesaplanir).
CREATE OR REPLACE FUNCTION public.has_perm(p_perm text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE public.my_role()
    WHEN 'admin' THEN true
    WHEN 'user' THEN p_perm = ANY (
      COALESCE(
        (SELECT ep.permissions FROM public.employee_permissions ep WHERE ep.profile_id = auth.uid()),
        public.default_employee_permissions()
      )
    )
    ELSE false
  END
$$;

-- Uygulamanin ekranlari acip kapatmasi icin: oturumdaki kullanicinin
-- gecerli yetki listesi (yonetici icin hepsi).
CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE public.my_role()
    WHEN 'admin' THEN public.all_employee_permissions()
    WHEN 'user' THEN COALESCE(
      (SELECT ep.permissions FROM public.employee_permissions ep WHERE ep.profile_id = auth.uid()),
      public.default_employee_permissions()
    )
    ELSE ARRAY[]::text[]
  END
$$;

REVOKE ALL ON FUNCTION public.has_perm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_perm(text) TO authenticated;
REVOKE ALL ON FUNCTION public.my_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_permissions() TO authenticated;


-- =============================================================================
-- Politikalar
-- =============================================================================

-- Randevular: "tum randevulari gor" yoksa yalnizca kendisine atanmis ya da
-- kendi actigi randevulari gorur. (Cakisma, appointments_no_overlap EXCLUDE
-- kisitiyla RLS'ten bagimsiz korunuyor.)
DROP POLICY IF EXISTS "appointments_select" ON public.appointments;
CREATE POLICY "appointments_select"
  ON public.appointments FOR SELECT
  USING (
    business_id = public.my_business_id()
    AND (
      (SELECT public.has_perm('randevu_tumu_gor'))
      OR employee_id = auth.uid()
      OR created_by_user_id = auth.uid()
    )
  );

-- Baskasinin randevusunu duzenleme (kendi actigi/kendisine atanmis olanlar
-- icin mevcut appointments_update_user / _assigned politikalari duruyor).
DROP POLICY IF EXISTS "appointments_update_perm" ON public.appointments;
CREATE POLICY "appointments_update_perm"
  ON public.appointments FOR UPDATE
  USING (
    business_id = public.my_business_id()
    AND public.my_role() = 'user'
    AND (SELECT public.has_perm('randevu_tumu_duzenle'))
  )
  WITH CHECK (business_id = public.my_business_id());

-- Odeme kaydetme.
DROP POLICY IF EXISTS "payments_insert" ON public.payments;
CREATE POLICY "payments_insert"
  ON public.payments FOR INSERT
  WITH CHECK (
    business_id = public.my_business_id()
    AND created_by_user_id = auth.uid()
    AND (SELECT public.has_perm('odeme_al'))
  );

-- Giderler (onceden yalnizca yonetici).
DROP POLICY IF EXISTS "business_expenses_admin_all" ON public.business_expenses;
DROP POLICY IF EXISTS "business_expenses_perm_all" ON public.business_expenses;
CREATE POLICY "business_expenses_perm_all"
  ON public.business_expenses FOR ALL
  USING ((SELECT public.has_perm('kasa')) AND business_id = public.my_business_id())
  WITH CHECK ((SELECT public.has_perm('kasa')) AND business_id = public.my_business_id());

-- Vergi/prim ayarlari: okuma Kasa ya da Performans yetkisiyle; yazma yine
-- yalnizca yonetici (business_finance_settings_admin_all).
DROP POLICY IF EXISTS "business_finance_settings_select_perm" ON public.business_finance_settings;
CREATE POLICY "business_finance_settings_select_perm"
  ON public.business_finance_settings FOR SELECT
  USING (
    business_id = public.my_business_id()
    AND ((SELECT public.has_perm('kasa')) OR (SELECT public.has_perm('raporlar')))
  );

-- Ekip yonetimi: calisma saatleri, izinler/tatiller, calisan-hizmet eslesmesi.
DROP POLICY IF EXISTS "employee_schedules_write_admin" ON public.employee_schedules;
DROP POLICY IF EXISTS "employee_schedules_write_perm" ON public.employee_schedules;
CREATE POLICY "employee_schedules_write_perm"
  ON public.employee_schedules FOR ALL
  USING (
    (SELECT public.has_perm('ekip_yonet'))
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = employee_schedules.profile_id AND p.business_id = public.my_business_id())
  )
  WITH CHECK (
    (SELECT public.has_perm('ekip_yonet'))
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = employee_schedules.profile_id AND p.business_id = public.my_business_id())
  );

DROP POLICY IF EXISTS "employee_time_blocks_write_admin" ON public.employee_time_blocks;
DROP POLICY IF EXISTS "employee_time_blocks_write_perm" ON public.employee_time_blocks;
CREATE POLICY "employee_time_blocks_write_perm"
  ON public.employee_time_blocks FOR ALL
  USING (
    (SELECT public.has_perm('ekip_yonet'))
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = employee_time_blocks.profile_id AND p.business_id = public.my_business_id())
  )
  WITH CHECK (
    (SELECT public.has_perm('ekip_yonet'))
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = employee_time_blocks.profile_id AND p.business_id = public.my_business_id())
  );

DROP POLICY IF EXISTS "employee_services_write_admin" ON public.employee_services;
DROP POLICY IF EXISTS "employee_services_write_perm" ON public.employee_services;
CREATE POLICY "employee_services_write_perm"
  ON public.employee_services FOR ALL
  USING (
    (SELECT public.has_perm('ekip_yonet') OR public.has_perm('hizmet_yonet'))
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = employee_services.profile_id AND p.business_id = public.my_business_id())
  )
  WITH CHECK (
    (SELECT public.has_perm('ekip_yonet') OR public.has_perm('hizmet_yonet'))
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = employee_services.profile_id AND p.business_id = public.my_business_id())
  );

-- Hizmetler ve fiyatlar.
DROP POLICY IF EXISTS "services_insert_admin" ON public.services;
DROP POLICY IF EXISTS "services_update_admin" ON public.services;
DROP POLICY IF EXISTS "services_delete_admin" ON public.services;
DROP POLICY IF EXISTS "services_insert_perm" ON public.services;
DROP POLICY IF EXISTS "services_update_perm" ON public.services;
DROP POLICY IF EXISTS "services_delete_perm" ON public.services;
CREATE POLICY "services_insert_perm"
  ON public.services FOR INSERT
  WITH CHECK (business_id = public.my_business_id() AND (SELECT public.has_perm('hizmet_yonet')));
CREATE POLICY "services_update_perm"
  ON public.services FOR UPDATE
  USING (business_id = public.my_business_id() AND (SELECT public.has_perm('hizmet_yonet')))
  WITH CHECK (business_id = public.my_business_id());
CREATE POLICY "services_delete_perm"
  ON public.services FOR DELETE
  USING (business_id = public.my_business_id() AND (SELECT public.has_perm('hizmet_yonet')));

-- WhatsApp konusmalari (bot service_role ile yazar; bu yalnizca okuma).
DROP POLICY IF EXISTS "chatbot_messages_select" ON public.chatbot_messages;
CREATE POLICY "chatbot_messages_select"
  ON public.chatbot_messages FOR SELECT
  USING (business_id = public.my_business_id() AND (SELECT public.has_perm('mesajlar')));

NOTIFY pgrst, 'reload schema';
