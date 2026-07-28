-- =============================================================================
-- Mobil test için: az önce chatbot üzerinden oluşturulan birkaç test randevusunu
-- "tamamlandı" işaretle (Muhasebe/Dashboard'da ciro görünsün) ve birkaç örnek
-- gider ekle.
-- =============================================================================

UPDATE public.appointments a
SET status = 'tamamlandi'
FROM public.customers c
WHERE a.customer_id = c.id
  AND c.phone IN ('05321112233', '05323334455', '05324445566');

INSERT INTO public.business_expenses (business_id, description, amount, expense_date)
SELECT id, 'Kira', 15000, CURRENT_DATE FROM public.businesses LIMIT 1;

INSERT INTO public.business_expenses (business_id, description, amount, expense_date)
SELECT id, 'Malzeme (oje, aseton vb.)', 2350.50, CURRENT_DATE - 2 FROM public.businesses LIMIT 1;

INSERT INTO public.business_expenses (business_id, description, amount, expense_date)
SELECT id, 'Elektrik faturası', 1840, CURRENT_DATE - 5 FROM public.businesses LIMIT 1;

INSERT INTO public.business_expenses (business_id, description, amount, expense_date)
SELECT id, 'Temizlik malzemesi', 620, CURRENT_DATE - 1 FROM public.businesses LIMIT 1;
