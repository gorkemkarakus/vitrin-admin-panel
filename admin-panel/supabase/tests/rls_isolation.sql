-- RLS izolasyon testi. Tek bir islem icinde calisir ve sonunda GERI ALINIR;
-- veritabaninda hicbir sey degismez. Calistirma: npm run test:rls
--
-- Senaryolar:
--   A) Isletme A yoneticisi, isletme B'nin business_id iceren TUM tablolarinda
--      okuma / guncelleme / silme / ekleme dener -> hepsi 0 satir ya da hata.
--   B) Isletme A'nin yetkisiz calisani (kasa ve yetki yonetimi yok) kendi
--      isletmesinde yoneticiye ait islemleri dener.
--   C) anon rolu (giris yapmamis) tablolari okuyamaz.
-- Sonuc: test, gecti, ayrinti. Basarisiz satir varsa run-rls-tests.mjs 1 ile cikar.
--
-- Test hesaplari: salon_admin@test.com, salon_user@test.com (Guzel Salon),
-- studio_admin@test.com (Fit Studio).

begin;

create temp table rls_result (test text, gecti boolean, ayrinti text);
grant all on rls_result to authenticated, anon;

create function pg_temp.as_user(p_email text) returns void language plpgsql as $$
declare v uuid;
begin
  select id into v from auth.users where email = p_email;
  if v is null then raise exception 'test hesabi yok: %', p_email; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
grant execute on function pg_temp.as_user(text) to authenticated, anon;

-- A) Isletmeler arasi izolasyon
do $$
declare
  other uuid := (select business_id from profiles where id = (select id from auth.users where email = 'studio_admin@test.com'));
  t text;
  n int;
begin
  perform pg_temp.as_user('salon_admin@test.com');
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'business_id' order by 1
  loop
    begin
      execute format('select count(*) from public.%I where business_id = $1', t) into n using other;
      insert into rls_result values ('A okuma: ' || t, n = 0, n || ' satir');
    exception when others then
      insert into rls_result values ('A okuma: ' || t, true, 'reddedildi');
    end;
    begin
      execute format('with u as (update public.%I set business_id = business_id where business_id = $1 returning 1) select count(*) from u', t) into n using other;
      insert into rls_result values ('A guncelleme: ' || t, n = 0, n || ' satir');
    exception when others then
      insert into rls_result values ('A guncelleme: ' || t, true, 'reddedildi');
    end;
    begin
      execute format('with d as (delete from public.%I where business_id = $1 returning 1) select count(*) from d', t) into n using other;
      insert into rls_result values ('A silme: ' || t, n = 0, n || ' satir');
    exception when others then
      insert into rls_result values ('A silme: ' || t, true, 'reddedildi');
    end;
  end loop;

  -- Baska isletmeye kayit eklenemez
  begin
    insert into public.customers (business_id, full_name) values (other, 'RLS testi');
    insert into rls_result values ('A ekleme: customers', false, 'baska isletmeye musteri eklendi');
  exception when others then
    insert into rls_result values ('A ekleme: customers', true, 'reddedildi');
  end;
  begin
    insert into public.appointments (business_id, scheduled_at, duration_minutes, status)
    values (other, now() + interval '30 day', 30, 'bekliyor');
    insert into rls_result values ('A ekleme: appointments', false, 'baska isletmeye randevu eklendi');
  exception when others then
    insert into rls_result values ('A ekleme: appointments', true, 'reddedildi');
  end;
  begin
    insert into public.payments (business_id, customer_id, amount, method)
    values (other, (select id from public.customers limit 1), 1, 'nakit');
    insert into rls_result values ('A ekleme: payments', false, 'baska isletmeye odeme eklendi');
  exception when others then
    insert into rls_result values ('A ekleme: payments', true, 'reddedildi');
  end;

  -- Kendi profilini baska isletmeye ya da yoneticilige tasiyamaz (calisan icin asagida)
  perform set_config('role', 'postgres', true);
end $$;

-- B) Ayni isletmede yetkisiz calisan
do $$
declare n int; me uuid := (select id from auth.users where email = 'salon_user@test.com');
begin
  perform pg_temp.as_user('salon_user@test.com');

  select count(*) into n from public.cash_closures;
  insert into rls_result values ('B calisan kasa kapanislarini okuyamaz', n = 0 or not public.has_perm('kasa'), n || ' satir');

  begin
    update public.profiles set role = 'admin' where id = me;
    select count(*) into n from public.profiles where id = me and role = 'admin';
    insert into rls_result values ('B calisan kendini yonetici yapamaz', n = 0, case when n = 0 then 'degismedi' else 'YONETICI OLDU' end);
  exception when others then
    insert into rls_result values ('B calisan kendini yonetici yapamaz', true, 'reddedildi');
  end;

  begin
    with u as (
      update public.employee_permissions set permissions = array['kasa'] where profile_id = me returning 1
    ) select count(*) into n from u;
    insert into rls_result values ('B calisan kendine yetki veremez', n = 0, n || ' satir');
  exception when others then
    insert into rls_result values ('B calisan kendine yetki veremez', true, 'reddedildi');
  end;

  begin
    with u as (update public.businesses set name = name returning 1) select count(*) into n from u;
    insert into rls_result values ('B calisan isletme adini degistiremez', n = 0, n || ' satir');
  exception when others then
    insert into rls_result values ('B calisan isletme adini degistiremez', true, 'reddedildi');
  end;

  perform set_config('role', 'postgres', true);
end $$;

-- C) anon (giris yapmamis)
do $$
declare t text; n int;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  foreach t in array array['customers', 'appointments', 'payments', 'businesses', 'profiles', 'services', 'business_expenses', 'chatbot_messages'] loop
    begin
      execute format('select count(*) from public.%I', t) into n;
      insert into rls_result values ('C anon okuma: ' || t, n = 0, n || ' satir');
    exception when others then
      insert into rls_result values ('C anon okuma: ' || t, true, 'reddedildi');
    end;
  end loop;
  perform set_config('role', 'postgres', true);
end $$;

select test, gecti, ayrinti from rls_result order by gecti, test;
rollback;
