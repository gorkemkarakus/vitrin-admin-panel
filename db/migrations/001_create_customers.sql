CREATE TABLE customers (
  id                 BIGSERIAL PRIMARY KEY,
  ad                 TEXT NOT NULL,
  telefon            TEXT,
  instagram_handle   TEXT,
  ilk_temas_tarihi   TIMESTAMPTZ,
  notlar             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chatbot'un gelen mesajdan müşteriyi tanıması için: aynı telefon/instagram
-- birden fazla müşteri kaydına düşmesin (NULL değerler kısıtlamadan muaf).
CREATE UNIQUE INDEX uq_customers_telefon ON customers (telefon) WHERE telefon IS NOT NULL;
CREATE UNIQUE INDEX uq_customers_instagram_handle ON customers (instagram_handle) WHERE instagram_handle IS NOT NULL;

CREATE TRIGGER trg_customers_updated_at
BEFORE UPDATE ON customers
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
