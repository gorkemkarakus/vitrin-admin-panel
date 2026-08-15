-- employee_time_blocks tek bir tarihle sinirliydi (block_date) — "yillik izin"
-- gibi birden fazla gunu kapsayan bloklar eklenemiyordu. end_date (opsiyonel)
-- eklendi: NULL ise eskisi gibi TEK gunluk blok, doluysa [block_date, end_date]
-- (her iki uc dahil) araligini kapsar.
ALTER TABLE public.employee_time_blocks
  ADD COLUMN IF NOT EXISTS end_date date;

ALTER TABLE public.employee_time_blocks
  ADD CONSTRAINT employee_time_blocks_end_date_check
    CHECK (end_date IS NULL OR (block_date IS NOT NULL AND end_date >= block_date));

CREATE OR REPLACE FUNCTION public.check_employee_schedule_hours()
RETURNS trigger
LANGUAGE plpgsql
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
