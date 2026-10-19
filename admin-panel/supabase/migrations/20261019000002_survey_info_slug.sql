-- Anket sayfasi salonun aydinlatma metnine (/aydinlatma/<slug>) baglanabilsin
-- diye survey_info salonun slug'ini da doner. Donus tipi degistigi icin
-- fonksiyon yeniden olusturulur.
DROP FUNCTION IF EXISTS public.survey_info(text);
CREATE FUNCTION public.survey_info(p_token text)
RETURNS TABLE (business_name text, business_slug text, first_name text, service_name text, visit_date date, state text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.name,
    b.slug,
    nullif(split_part(btrim(c.full_name), ' ', 1), ''),
    sv.name,
    (a.scheduled_at AT TIME ZONE 'Europe/Istanbul')::date,
    CASE WHEN s.responded_at IS NOT NULL THEN 'yanitlandi'
         WHEN s.expires_at < now() THEN 'suresi_doldu'
         ELSE 'acik' END
  FROM public.surveys s
  JOIN public.businesses b ON b.id = s.business_id
  JOIN public.appointments a ON a.id = s.appointment_id
  JOIN public.customers c ON c.id = s.customer_id
  LEFT JOIN public.services sv ON sv.id = a.service_id
  WHERE p_token ~ '^[0-9a-f]{64}$' AND s.token = p_token AND c.full_name <> 'Silinmiş müşteri'
$$;
REVOKE ALL ON FUNCTION public.survey_info(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.survey_info(text) TO anon, authenticated;
