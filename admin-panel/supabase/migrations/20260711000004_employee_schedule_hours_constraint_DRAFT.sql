-- =============================================================================
-- TASLAK — UYGULANMADI (bu dosya bilinçli olarak `supabase db push` ile
-- production'a gönderilmedi, sadece inceleme için hazırlandı).
-- =============================================================================
-- Bulgu: appointments.scheduled_at / employee_id, ilgili çalışanın
-- employee_schedules'daki çalışma saatleri dışına sadece İSTEMCİ tarafında
-- (AppointmentsPage.tsx → isEmployeeAvailable, book-appointment Edge
-- Function → isAvailable) engelleniyor. Bu bir DB constraint/trigger DEĞİL.
--
-- appointments_update_user RLS politikası (20260621000002) sadece
-- business_id = my_business_id() VE created_by_user_id = auth.uid() kontrol
-- ediyor — hangi saate/hangi çalışana taşındığını KISITLAMIYOR. Çakışma
-- (iki randevunun aynı çalışanda üst üste binmesi) DB seviyesinde korunuyor
-- (appointments_no_overlap exclusion constraint, bkz. 20260706000005) ama
-- "bu çalışan bu saatte gerçekten mesaide mi" DB seviyesinde HİÇ
-- doğrulanmıyor.
--
-- Etki (düşük/orta önem — veri bütünlüğü, GÜVENLİK AÇIĞI DEĞİL): bir 'user'
-- rolü, tarayıcı konsolundan veya doğrudan REST çağrısıyla KENDİ oluşturduğu
-- bir randevuyu (RLS buna izin veriyor) çalışma saatleri dışına (ör. gece
-- yarısı) ya da o hizmeti veremeyecek bir çalışana taşıyabilir. Başka bir
-- kullanıcının randevusuna erişemez — RLS bunu zaten engelliyor.
--
-- Bu trigger, book-appointment Edge Function'ın zaten yaptığı kontrolü
-- (isAvailable → çalışma saatleri kısmı) DB seviyesinde de zorunlu kılar;
-- Edge Function service_role ile yazdığı için trigger'dan etkilenmez RLS
-- gibi ama trigger'lar role bakmaksızın HER YAZMADA çalışır — Edge
-- Function'ın kendi ön-kontrolü zaten doğruysa bu trigger onunla çakışmaz,
-- sadece istemci tarafını bypass eden yazmalara karşı ikinci bir savunma
-- katmanı ekler.
--
-- NOT: new.ends_at üzerinden DEĞİL, new.scheduled_at + duration_minutes
-- üzerinden hesaplama yapılıyor çünkü bu trigger'ın adı alfabetik olarak
-- "trg_set_appointment_ends_at" trigger'ından ÖNCE gelip önce çalışabilir —
-- o an new.ends_at henüz güncellenmemiş/stale olabilir.
--
-- Uygulamadan önce: mevcut appointments verisinde bu kurala uymayan (ör.
-- employee_schedules eklenmeden önce girilmiş) satır olup olmadığı kontrol
-- edilmeli, yoksa trigger ekleme anında geçmiş veriyle çakışmaz (trigger
-- sadece INSERT/UPDATE anında çalışır, mevcut satırları geriye dönük
-- doğrulamaz) ama ondan sonraki ilk UPDATE'te (ör. sadece status değişikliği
-- dışında scheduled_at/employee_id/duration_minutes değişirse) sürpriz
-- reddedilme yaşanabilir.
-- =============================================================================

create or replace function public.check_employee_schedule_hours()
returns trigger
language plpgsql
as $$
declare
  ok boolean;
  computed_end timestamptz;
begin
  if new.status = 'iptal' or new.employee_id is null then
    return new;
  end if;

  computed_end := new.scheduled_at + make_interval(mins => coalesce(new.duration_minutes, 30));

  select exists (
    select 1 from public.employee_schedules s
    where s.profile_id = new.employee_id
      and s.day_of_week = extract(dow from (new.scheduled_at at time zone 'Europe/Istanbul'))
      and s.starts_at <= (new.scheduled_at at time zone 'Europe/Istanbul')::time
      and s.ends_at   >= (computed_end   at time zone 'Europe/Istanbul')::time
  ) into ok;

  if not ok then
    raise exception 'Bu çalışan bu saatte mesaide değil.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_check_employee_schedule_hours on public.appointments;
create trigger trg_check_employee_schedule_hours
  before insert or update of scheduled_at, duration_minutes, employee_id, status
  on public.appointments
  for each row execute function public.check_employee_schedule_hours();
