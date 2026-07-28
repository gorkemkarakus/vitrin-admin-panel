CREATE TABLE appointments (
  id             BIGSERIAL PRIMARY KEY,
  customer_id    BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  employee_id    BIGINT REFERENCES employees(id) ON DELETE SET NULL,
  service_id     BIGINT REFERENCES services(id) ON DELETE SET NULL,
  tarih_saat     TIMESTAMPTZ NOT NULL,
  durum          TEXT NOT NULL DEFAULT 'bekliyor'
                   CHECK (durum IN ('bekliyor', 'onaylandı', 'tamamlandı', 'iptal')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uygun saat hesaplama ve takvim görünümü bu iki index üzerinden sorgulanacak.
CREATE INDEX idx_appointments_tarih_saat ON appointments (tarih_saat);
CREATE INDEX idx_appointments_employee_id ON appointments (employee_id);
CREATE INDEX idx_appointments_customer_id ON appointments (customer_id);

CREATE TRIGGER trg_appointments_updated_at
BEFORE UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
