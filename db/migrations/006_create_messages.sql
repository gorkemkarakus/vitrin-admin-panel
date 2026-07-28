-- Not: "yön" alanı ASCII uyumluluğu için "yon" olarak adlandırıldı (gelen/giden).
CREATE TABLE messages (
  id                BIGSERIAL PRIMARY KEY,
  conversation_id   BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  yon               TEXT NOT NULL CHECK (yon IN ('gelen', 'giden')),
  icerik            TEXT NOT NULL,
  tarih             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation_id ON messages (conversation_id);
CREATE INDEX idx_messages_tarih ON messages (tarih);
