-- book-appointment fonksiyonu ve mevcut trg_check_employee_conflict trigger'i
-- musaitligi "once oku (SELECT count), sonra karar ver" mantigiyla kontrol
-- ediyor. Bu "check-then-act" deseni Postgres'te ATOMIK DEGIL: iki eszamanli
-- transaction ayni anda SELECT'i calistirip ikisi de "cakisma yok" gorebilir,
-- ikisi de INSERT eder. Empirik olarak dogrulandi: dogrudan API cagrisiyla
-- ayni calisan+saate iki ayri randevu olusturuldu, mevcut trigger bunu
-- engelleyemedi. Gercek cozum, Postgres'in INDEX seviyesinde atomik olarak
-- uyguladigi bir EXCLUSION CONSTRAINT.
--
-- Exclusion constraint index kullandigi icin ifadesi IMMUTABLE olmali, ama
-- timestamptz + interval STABLE'dir (timezone'a bagli) — bu yuzden hesabi bir
-- trigger ile gercek bir "ends_at" kolonuna yaziyoruz, constraint ise duz iki
-- kolonu (scheduled_at, ends_at) kullaniyor.

-- Eski, race condition'a acik trigger'i once devre disi birak ki asagidaki
-- backfill/temizlik islemleri sirasinda yanlislikla devreye girip (henuz
-- temizlenmemis cakismalari gorup) islemi engellemesin.
alter table public.appointments disable trigger trg_check_employee_conflict;

alter table public.appointments add column if not exists ends_at timestamptz;

update public.appointments
set ends_at = scheduled_at + make_interval(mins => coalesce(duration_minutes, 30))
where ends_at is null;

alter table public.appointments alter column ends_at set not null;

create or replace function public.set_appointment_ends_at()
returns trigger
language plpgsql
as $$
begin
  new.ends_at := new.scheduled_at + make_interval(mins => coalesce(new.duration_minutes, 30));
  return new;
end;
$$;

drop trigger if exists trg_set_appointment_ends_at on public.appointments;
create trigger trg_set_appointment_ends_at
  before insert or update of scheduled_at, duration_minutes on public.appointments
  for each row execute function public.set_appointment_ends_at();

-- Mevcut (test verisinden kalma dahil) cakismalari temizle, yoksa asagidaki
-- constraint eklenemez: her calisan icin cakisan randevulardan en eski
-- olusturulani birakip digerlerini iptal durumuna al.
with ranked as (
  select id, employee_id,
    tstzrange(scheduled_at, ends_at) as slot,
    row_number() over (partition by employee_id order by created_at) as rn
  from public.appointments
  where status <> 'iptal' and employee_id is not null
),
conflicts as (
  select a.id
  from ranked a
  join ranked b
    on a.employee_id = b.employee_id
   and a.id <> b.id
   and a.slot && b.slot
   and b.rn < a.rn
)
update public.appointments set status = 'iptal'
where id in (select id from conflicts);

create extension if not exists btree_gist;

alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    employee_id with =,
    tstzrange(scheduled_at, ends_at) with &&
  )
  where (status <> 'iptal' and employee_id is not null);

-- Eski trigger artik gereksiz (ve racy) — gercek koruma artik yukaridaki
-- exclusion constraint tarafindan atomik olarak saglaniyor.
drop trigger if exists trg_check_employee_conflict on public.appointments;
drop function if exists public.check_employee_appointment_conflict();
