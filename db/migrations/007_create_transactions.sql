CREATE TABLE transactions (
  id               BIGSERIAL PRIMARY KEY,
  appointment_id   BIGINT REFERENCES appointments(id) ON DELETE SET NULL,
  tutar            NUMERIC(10,2) NOT NULL,
  tur              TEXT NOT NULL CHECK (tur IN ('gelir', 'gider')),
  tarih            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- appointment_id NULL olabilir: gider kayıtları (örn. malzeme alımı) bir randevuya bağlı değildir.
CREATE INDEX idx_transactions_tarih ON transactions (tarih);
CREATE INDEX idx_transactions_appointment_id ON transactions (appointment_id);
