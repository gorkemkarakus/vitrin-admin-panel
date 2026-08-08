-- Bir giderin "tarihi" (fatura kesim/gider tarihi) ile "son odeme tarihi"
-- (vade) farkli seyler olabilir — ör. 1 Ocak'ta kesilen fatura 15 Ocak'a
-- kadar odenebilir. due_date opsiyonel: girilmezse mevcut davranis
-- (expense_date uzerinden hatirlatma) aynen devam eder.
ALTER TABLE public.business_expenses ADD COLUMN IF NOT EXISTS due_date date;
