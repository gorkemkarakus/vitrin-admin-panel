-- WhatsApp sifirdan kurulacak; o zamana kadar musteriye OTOMATIK giden
-- mesajlar durduruldu (kullanici istegi, 2026-10-15):
--   1) Randevu eklenince onay mesaji (trg_notify_appointment_created ->
--      send-appointment-notification).
--   2) 15 dakikada bir randevu hatirlatmasi (cron: process-appointment-reminders).
-- Geri acmak icin:
--   ALTER TABLE public.appointments ENABLE TRIGGER trg_notify_appointment_created;
--   SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'process-appointment-reminders'), active := true);
ALTER TABLE public.appointments DISABLE TRIGGER trg_notify_appointment_created;

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'process-appointment-reminders'),
  active := false
);
