-- =============================================================================
-- 1) Online randevu sayfasini acip kapatma
-- =============================================================================
-- Kapaliyken public-booking-info / public-book-appointment "bu salon su an
-- online randevu almiyor" doner (iki fonksiyon da service_role ile okur).
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS online_booking_enabled boolean NOT NULL DEFAULT true;

-- businesses sutun seviyesinde kilitli (bkz. 20260725000008) — yalnizca bu
-- sutun acilir; satir izni businesses update politikasiyla yoneticide.
GRANT SELECT (online_booking_enabled), UPDATE (online_booking_enabled) ON public.businesses TO authenticated;


-- =============================================================================
-- 2) KVKK: musteriyi anonimlestirme
-- =============================================================================
-- Silmek (DELETE) odemeleri ve paketleri CASCADE ile goturur, kasa gecmisi
-- bozulur. Bunun yerine kisisel veriler temizlenir; randevu/odeme kayitlari
-- isimsiz olarak kalir. notification_log'a istemcinin yazma izni olmadigi
-- icin tek bir SECURITY DEFINER fonksiyonla, yonetici kontroluyle yapilir.
CREATE OR REPLACE FUNCTION public.anonymize_customer(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Sadece yönetici yapabilir' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.customers WHERE id = p_customer_id AND business_id = public.my_business_id()
  ) THEN
    RAISE EXCEPTION 'Müşteri bulunamadı' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.customers
  SET full_name = 'Silinmiş müşteri',
      phone = NULL,
      contact_phone = NULL,
      email = NULL,
      notes = NULL,
      bot_paused_until = NULL
  WHERE id = p_customer_id;

  DELETE FROM public.customer_group_members WHERE customer_id = p_customer_id;

  UPDATE public.notification_log
  SET phone = NULL,
      message = '[kişisel veri silindi]'
  WHERE customer_id = p_customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_customer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anonymize_customer(uuid) TO authenticated;


-- =============================================================================
-- 3) Mukerrer musteri birlestirme
-- =============================================================================
-- p_drop'un tum kayitlari p_keep'e tasinir, p_drop silinir. Tek islemde
-- (fonksiyon atomik) — yarida kalip yarim tasinmis musteri birakmaz.
CREATE OR REPLACE FUNCTION public.merge_customers(p_keep uuid, p_drop uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_biz uuid := public.my_business_id();
  v_drop public.customers%ROWTYPE;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Sadece yönetici yapabilir' USING ERRCODE = '42501';
  END IF;
  IF p_keep = p_drop THEN
    RAISE EXCEPTION 'Aynı müşteri seçildi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_keep AND business_id = v_biz) THEN
    RAISE EXCEPTION 'Müşteri bulunamadı' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_drop FROM public.customers WHERE id = p_drop AND business_id = v_biz;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Müşteri bulunamadı' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.appointments     SET customer_id = p_keep WHERE customer_id = p_drop;
  UPDATE public.payments         SET customer_id = p_keep WHERE customer_id = p_drop;
  UPDATE public.service_packages SET customer_id = p_keep WHERE customer_id = p_drop;
  UPDATE public.notification_log SET customer_id = p_keep WHERE customer_id = p_drop;

  INSERT INTO public.customer_group_members (group_id, customer_id, business_id)
  SELECT group_id, p_keep, business_id FROM public.customer_group_members WHERE customer_id = p_drop
  ON CONFLICT DO NOTHING;

  -- Telefon (business_id, phone) uzerinde UNIQUE: once eski kayit silinir,
  -- sonra eksik alanlar korunan kayda aktarilir.
  DELETE FROM public.customers WHERE id = p_drop;

  UPDATE public.customers c
  SET phone = COALESCE(c.phone, v_drop.phone),
      contact_phone = COALESCE(c.contact_phone, v_drop.contact_phone),
      email = COALESCE(c.email, v_drop.email),
      notes = CASE
        WHEN v_drop.notes IS NULL OR v_drop.notes = '' THEN c.notes
        WHEN c.notes IS NULL OR c.notes = '' THEN v_drop.notes
        ELSE c.notes || E'\n' || v_drop.notes
      END,
      credit_balance = c.credit_balance + v_drop.credit_balance,
      created_at = LEAST(c.created_at, v_drop.created_at)
  WHERE c.id = p_keep;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_customers(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_customers(uuid, uuid) TO authenticated;


-- =============================================================================
-- 4) Randevu tetikleyicileri: sadece saat/sure/calisan degisince kontrol et
-- =============================================================================
-- check_employee_schedule_hours ve check_employee_appointment_conflict HER
-- UPDATE'te calisiyordu. Sonradan mesai saati degisen ya da o gune izin
-- girilen bir calisanin ESKI randevusunda sadece durum (tamamlandi/gelmedi)
-- ya da musteri degistirmek bile "mesaide degil"/"bloke" hatasiyla
-- reddediliyordu (musteri birlestirme de bu yuzden takilirdi). Zamanlama
-- alanlari ayniysa ve randevu iptalden geri acilmiyorsa kontrol atlanir;
-- fonksiyonlarin geri kalani aynen korunuyor.
CREATE OR REPLACE FUNCTION public.check_employee_schedule_hours()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  ok boolean;
  computed_end timestamptz;
  blocked boolean;
  appt_date date;
BEGIN
  IF new.status = 'iptal' OR new.employee_id IS NULL THEN
    RETURN new;
  END IF;

  IF TG_OP = 'UPDATE'
     AND new.scheduled_at = old.scheduled_at
     AND new.duration_minutes IS NOT DISTINCT FROM old.duration_minutes
     AND new.employee_id IS NOT DISTINCT FROM old.employee_id
     AND old.status <> 'iptal' THEN
    RETURN new;
  END IF;

  computed_end := new.scheduled_at + make_interval(mins => coalesce(new.duration_minutes, 30));
  appt_date := (new.scheduled_at AT TIME ZONE 'Europe/Istanbul')::date;

  SELECT EXISTS (
    SELECT 1 FROM public.employee_schedules s
    WHERE s.profile_id = new.employee_id
      AND s.day_of_week = extract(dow FROM (new.scheduled_at AT TIME ZONE 'Europe/Istanbul'))
      AND s.starts_at <= (new.scheduled_at AT TIME ZONE 'Europe/Istanbul')::time
      AND s.ends_at   >= (computed_end   AT TIME ZONE 'Europe/Istanbul')::time
  ) INTO ok;

  IF NOT ok THEN
    RAISE EXCEPTION 'Bu çalışan bu saatte mesaide değil.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.employee_time_blocks b
    WHERE b.profile_id = new.employee_id
      AND (
        (b.day_of_week IS NOT NULL AND b.day_of_week = extract(dow FROM (new.scheduled_at AT TIME ZONE 'Europe/Istanbul')))
        OR (b.block_date IS NOT NULL AND appt_date BETWEEN b.block_date AND coalesce(b.end_date, b.block_date))
      )
      AND b.starts_at < (computed_end AT TIME ZONE 'Europe/Istanbul')::time
      AND b.ends_at > (new.scheduled_at AT TIME ZONE 'Europe/Istanbul')::time
  ) INTO blocked;

  IF blocked THEN
    RAISE EXCEPTION 'Bu çalışan bu saatte bloke (mola/eğitim/izin vb.).';
  END IF;

  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_employee_appointment_conflict()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_end timestamptz;
  conflict_count int;
BEGIN
  IF NEW.status = 'iptal' OR NEW.employee_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.scheduled_at = OLD.scheduled_at
     AND NEW.duration_minutes IS NOT DISTINCT FROM OLD.duration_minutes
     AND NEW.employee_id IS NOT DISTINCT FROM OLD.employee_id
     AND OLD.status <> 'iptal' THEN
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
$$;

NOTIFY pgrst, 'reload schema';
