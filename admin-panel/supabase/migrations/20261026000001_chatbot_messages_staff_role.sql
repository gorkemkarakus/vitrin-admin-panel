-- Salonun kendisinin yazdigi mesajlar (uygulamadaki Mesajlar ekranindan ya da
-- telefondaki WhatsApp Business'tan) artik 'assistant' (bot) yerine 'staff'
-- olarak tutulur; uygulamada "Bot" degil "Salon" diye gorunur. Bot icin
-- gecmiste yine isletmenin cevabidir (chatbot-context 'staff'i 'assistant'a
-- cevirir).
ALTER TABLE public.chatbot_messages DROP CONSTRAINT IF EXISTS chatbot_messages_role_check;
ALTER TABLE public.chatbot_messages ADD CONSTRAINT chatbot_messages_role_check
  CHECK (role IN ('user', 'assistant', 'staff'));
