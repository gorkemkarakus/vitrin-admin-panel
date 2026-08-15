-- Test verisi sifirlama: mevcut butun randevular/paketler/odemeler silinip
-- uygulamanin tum durumlarini (bekliyor/onaylandi/tamamlandi/iptal, paket
-- ilerlemesi, tam/kismi/hic odenmemis borc) test edebilecegimiz kucuk, temiz
-- bir test seti olusturuluyor. En cok musteri kaydi olan (aktif test)
-- isletmeye ait veriler etkileniyor — diger isletmelere dokunulmuyor.
--
-- employee_id kasitli olarak NULL birakiliyor: trg_check_employee_schedule_hours
-- trigger'i employee_id atanmis randevularda gercek employee_schedules
-- calisma saatlerini zorunlu kiliyor, rastgele test saatleri bunu ihlal
-- edebilir — employee_id NULL oldugunda trigger devre disi kaliyor.

DO $$
DECLARE
  v_business_id  uuid;
  v_customer_1   uuid;
  v_customer_2   uuid;
  v_customer_3   uuid;
  v_customer_4   uuid;
  v_service_1    uuid;
  v_service_1_price numeric;
  v_service_2    uuid;
  v_admin_user   uuid;
  v_package_id   uuid;
  v_appt_id      uuid;
BEGIN
  SELECT business_id INTO v_business_id
  FROM public.customers
  GROUP BY business_id
  ORDER BY count(*) DESC
  LIMIT 1;

  IF v_business_id IS NULL THEN
    RAISE NOTICE 'Musteri bulunamadi, test verisi olusturulamadi.';
    RETURN;
  END IF;

  DELETE FROM public.payments WHERE business_id = v_business_id;
  DELETE FROM public.appointments WHERE business_id = v_business_id;
  DELETE FROM public.service_packages WHERE business_id = v_business_id;

  SELECT id INTO v_customer_1 FROM public.customers WHERE business_id = v_business_id ORDER BY full_name LIMIT 1 OFFSET 0;
  SELECT id INTO v_customer_2 FROM public.customers WHERE business_id = v_business_id ORDER BY full_name LIMIT 1 OFFSET 1;
  SELECT id INTO v_customer_3 FROM public.customers WHERE business_id = v_business_id ORDER BY full_name LIMIT 1 OFFSET 2;
  SELECT id INTO v_customer_4 FROM public.customers WHERE business_id = v_business_id ORDER BY full_name LIMIT 1 OFFSET 3;

  SELECT id, price INTO v_service_1, v_service_1_price
  FROM public.services WHERE business_id = v_business_id AND is_active = true ORDER BY name LIMIT 1;
  SELECT id INTO v_service_2
  FROM public.services WHERE business_id = v_business_id AND is_active = true ORDER BY name LIMIT 1 OFFSET 1;

  SELECT id INTO v_admin_user FROM public.profiles WHERE business_id = v_business_id AND role = 'admin' LIMIT 1;

  IF v_customer_1 IS NULL OR v_service_1 IS NULL OR v_admin_user IS NULL THEN
    RAISE NOTICE 'Yeterli musteri/hizmet/profil bulunamadi, test verisi olusturulamadi.';
    RETURN;
  END IF;

  -- 1) Bekliyor — yarina planli, henuz onaylanmamis
  INSERT INTO public.appointments
    (business_id, customer_id, service_id, created_by_user_id, scheduled_at, duration_minutes, status, source)
  VALUES
    (v_business_id, v_customer_1, v_service_1, v_admin_user, now() + interval '1 day' + interval '2 hour', 60, 'bekliyor', 'kullanici_uzerinden');

  -- 2) Onaylandi — bugun icin
  INSERT INTO public.appointments
    (business_id, customer_id, service_id, created_by_user_id, scheduled_at, duration_minutes, status, source)
  VALUES
    (v_business_id, v_customer_2, v_service_1, v_admin_user, date_trunc('day', now()) + interval '15 hour', 60, 'onaylandi', 'dogrudan_musteri');

  -- 3) Tamamlandi + TAM odeme (borcu yok)
  INSERT INTO public.appointments
    (business_id, customer_id, service_id, created_by_user_id, scheduled_at, duration_minutes, status, source)
  VALUES
    (v_business_id, v_customer_1, v_service_1, v_admin_user, now() - interval '2 day', 60, 'tamamlandi', 'kullanici_uzerinden')
  RETURNING id INTO v_appt_id;
  INSERT INTO public.payments
    (business_id, customer_id, appointment_id, amount, method, paid_at, created_by_user_id)
  VALUES
    (v_business_id, v_customer_1, v_appt_id, coalesce(v_service_1_price, 0), 'nakit', (now() - interval '2 day')::date, v_admin_user);

  -- 4) Tamamlandi + KISMI odeme (borclu — Musteriler/Ana Sayfa'da gorunmeli)
  INSERT INTO public.appointments
    (business_id, customer_id, service_id, created_by_user_id, scheduled_at, duration_minutes, status, source)
  VALUES
    (v_business_id, v_customer_2, v_service_1, v_admin_user, now() - interval '3 day', 60, 'tamamlandi', 'kullanici_uzerinden')
  RETURNING id INTO v_appt_id;
  INSERT INTO public.payments
    (business_id, customer_id, appointment_id, amount, method, paid_at, created_by_user_id)
  VALUES
    (v_business_id, v_customer_2, v_appt_id, greatest(coalesce(v_service_1_price, 0) - 100, 0), 'kart', (now() - interval '3 day')::date, v_admin_user);

  -- 5) Tamamlandi + HIC odeme yok (tamami borc)
  INSERT INTO public.appointments
    (business_id, customer_id, service_id, created_by_user_id, scheduled_at, duration_minutes, status, source)
  VALUES
    (v_business_id, v_customer_3, v_service_1, v_admin_user, now() - interval '5 day', 60, 'tamamlandi', 'chatbot');

  -- 6) Iptal edilmis bir randevu
  INSERT INTO public.appointments
    (business_id, customer_id, service_id, created_by_user_id, scheduled_at, duration_minutes, status, source)
  VALUES
    (v_business_id, v_customer_3, coalesce(v_service_2, v_service_1), v_admin_user, now() - interval '1 day', 45, 'iptal', 'kullanici_uzerinden');

  -- 7) Paket senaryosu: 5 seanslik paket, ilk 2 seans tamamlandi (biri tam
  --    odenmis, biri kismi odenmis), 3. seans "devam randevusu" olarak
  --    gelecege planli — paket ilerlemesi/rozeti ve karisik borc durumunu
  --    ayni musteride test etmek icin.
  INSERT INTO public.service_packages
    (business_id, customer_id, service_id, total_sessions, created_by_user_id)
  VALUES
    (v_business_id, v_customer_4, v_service_1, 5, v_admin_user)
  RETURNING id INTO v_package_id;

  INSERT INTO public.appointments
    (business_id, customer_id, service_id, created_by_user_id, scheduled_at, duration_minutes, status, source, package_id)
  VALUES
    (v_business_id, v_customer_4, v_service_1, v_admin_user, now() - interval '14 day', 60, 'tamamlandi', 'kullanici_uzerinden', v_package_id)
  RETURNING id INTO v_appt_id;
  INSERT INTO public.payments
    (business_id, customer_id, appointment_id, package_id, amount, method, paid_at, created_by_user_id)
  VALUES
    (v_business_id, v_customer_4, v_appt_id, v_package_id, coalesce(v_service_1_price, 0), 'nakit', (now() - interval '14 day')::date, v_admin_user);

  INSERT INTO public.appointments
    (business_id, customer_id, service_id, created_by_user_id, scheduled_at, duration_minutes, status, source, package_id)
  VALUES
    (v_business_id, v_customer_4, v_service_1, v_admin_user, now() - interval '7 day', 60, 'tamamlandi', 'kullanici_uzerinden', v_package_id)
  RETURNING id INTO v_appt_id;
  INSERT INTO public.payments
    (business_id, customer_id, appointment_id, package_id, amount, method, paid_at, created_by_user_id)
  VALUES
    (v_business_id, v_customer_4, v_appt_id, v_package_id, greatest(coalesce(v_service_1_price, 0) - 150, 0), 'diger', (now() - interval '7 day')::date, v_admin_user);

  INSERT INTO public.appointments
    (business_id, customer_id, service_id, created_by_user_id, scheduled_at, duration_minutes, status, source, package_id)
  VALUES
    (v_business_id, v_customer_4, v_service_1, v_admin_user, now() + interval '2 day' + interval '11 hour', 60, 'bekliyor', 'kullanici_uzerinden', v_package_id);

END $$;
