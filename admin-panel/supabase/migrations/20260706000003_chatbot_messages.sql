-- Chatbot konuşma geçmişi: n8n akışının müşteri bazlı konuşma bağlamını
-- (context) oluşturmak için son mesajları okuyabilmesi gerekiyor.
CREATE TABLE IF NOT EXISTS public.chatbot_messages (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_phone text NOT NULL,
  role           text NOT NULL CHECK (role IN ('user', 'assistant')),
  content        text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chatbot_messages_business_phone_created
  ON public.chatbot_messages (business_id, customer_phone, created_at);

ALTER TABLE public.chatbot_messages ENABLE ROW LEVEL SECURITY;

-- Sadece işletme üyeleri kendi işletmelerinin mesajlarını görebilir.
-- Ekleme (insert) sadece service_role (Edge Function) üzerinden yapılır,
-- bu yüzden authenticated roller için ayrı bir INSERT policy tanımlanmadı.
CREATE POLICY "chatbot_messages_select"
  ON public.chatbot_messages FOR SELECT
  USING (business_id = public.my_business_id());
