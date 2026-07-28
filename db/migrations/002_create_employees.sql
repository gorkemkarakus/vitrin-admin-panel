CREATE TABLE employees (
  id             BIGSERIAL PRIMARY KEY,
  ad             TEXT NOT NULL,
  rol            TEXT,
  prim_yuzdesi   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (prim_yuzdesi >= 0 AND prim_yuzdesi <= 100),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_employees_updated_at
BEFORE UPDATE ON employees
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
