CREATE TABLE conversations (
  id                 BIGSERIAL PRIMARY KEY,
  customer_id        BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kanal              TEXT NOT NULL CHECK (kanal IN ('instagram', 'whatsapp')),
  son_mesaj_tarihi   TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_conversations_customer_id ON conversations (customer_id);

CREATE TRIGGER trg_conversations_updated_at
BEFORE UPDATE ON conversations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
