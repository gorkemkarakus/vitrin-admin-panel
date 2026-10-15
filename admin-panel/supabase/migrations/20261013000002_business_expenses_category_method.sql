-- Giderler ekraninin yeni tasariminda (kategori cipleri + "odeme sekli")
-- kullanilan iki alan. Ikisi de istege bagli; eski kayitlarda NULL kalir ve
-- ekranda "Diger" / bos olarak gosterilir.
ALTER TABLE public.business_expenses
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS payment_method text;

ALTER TABLE public.business_expenses
  DROP CONSTRAINT IF EXISTS business_expenses_payment_method_check;
ALTER TABLE public.business_expenses
  ADD CONSTRAINT business_expenses_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('nakit', 'kart', 'havale', 'diger'));
