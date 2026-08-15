-- WhatsApp Coexistence ile personel bir musteri konusmasina telefon
-- uygulamasindan elle mudahale edebilecek — bu sirada bot da ayni numaraya
-- cevap vermeye devam ederse ust uste binen/celisen mesaj riski var.
-- bot_paused_until NULL ise bot normal calisir; gelecekte bir zaman damgasi
-- varsa bot o ana kadar bu musteriye SESSIZ kalir (mesaji yine de loglar,
-- sadece cevap uretmez) — sure dolunca OTOMATIK devreye girer, personelin
-- "geri ac" diye ayrica bir islem yapmayi UNUTMASI riskini ortadan kaldirir.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS bot_paused_until timestamptz;
