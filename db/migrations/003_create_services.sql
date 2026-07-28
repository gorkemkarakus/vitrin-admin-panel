CREATE TABLE services (
  id            BIGSERIAL PRIMARY KEY,
  ad            TEXT NOT NULL,
  sure_dakika   INTEGER NOT NULL CHECK (sure_dakika > 0),
  fiyat         NUMERIC(10,2) NOT NULL CHECK (fiyat >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_services_updated_at
BEFORE UPDATE ON services
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
