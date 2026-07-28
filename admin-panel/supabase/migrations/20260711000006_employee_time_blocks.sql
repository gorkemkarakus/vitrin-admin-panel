-- =============================================================================
-- employee_time_blocks — çalışma saatlerinden AYRI, "bu aralıkta müsait
-- değilim" bloklamaları (mola, eğitim vb.). Ya haftalık tekrar eden
-- (day_of_week doluysa) ya da tek seferlik belirli bir tarih (block_date
-- doluysa) olabilir — ikisi birden asla dolu olamaz.
-- =============================================================================

CREATE TABLE public.employee_time_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  day_of_week smallint CHECK (day_of_week BETWEEN 0 AND 6),
  block_date  date,
  starts_at   time NOT NULL,
  ends_at     time NOT NULL,
  label       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK ((day_of_week IS NOT NULL) <> (block_date IS NOT NULL))
);

CREATE INDEX idx_employee_time_blocks_profile_id ON public.employee_time_blocks (profile_id);

ALTER TABLE public.employee_time_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_time_blocks_select"
  ON public.employee_time_blocks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_time_blocks.profile_id
        AND p.business_id = public.my_business_id()
    )
  );

CREATE POLICY "employee_time_blocks_write_admin"
  ON public.employee_time_blocks FOR ALL
  USING (
    public.my_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_time_blocks.profile_id
        AND p.business_id = public.my_business_id()
    )
  )
  WITH CHECK (
    public.my_role() = 'admin'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = employee_time_blocks.profile_id
        AND p.business_id = public.my_business_id()
    )
  );

-- =============================================================================
-- check_employee_schedule_hours (20260711000004'te tanımlandı) artık bloke
-- saatlerle çakışmayı da reddediyor — mesai içinde olsa bile bloke aralığına
-- denk gelen bir randevu reddedilir.
-- =============================================================================
create or replace function public.check_employee_schedule_hours()
returns trigger
language plpgsql
as $$
declare
  ok boolean;
  computed_end timestamptz;
  blocked boolean;
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

  select exists (
    select 1 from public.employee_time_blocks b
    where b.profile_id = new.employee_id
      and (
        (b.day_of_week is not null and b.day_of_week = extract(dow from (new.scheduled_at at time zone 'Europe/Istanbul')))
        or (b.block_date is not null and b.block_date = (new.scheduled_at at time zone 'Europe/Istanbul')::date)
      )
      and b.starts_at < (computed_end at time zone 'Europe/Istanbul')::time
      and b.ends_at > (new.scheduled_at at time zone 'Europe/Istanbul')::time
  ) into blocked;

  if blocked then
    raise exception 'Bu çalışan bu saatte bloke (mola/eğitim vb.).';
  end if;

  return new;
end;
$$;
