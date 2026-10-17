-- Kendi kendine kayit (register-business fonksiyonu). Supabase'in herkese
-- acik kaydi KAPALI kalir; hesap yalnizca o fonksiyonda acilir.

-- Kaydin nereden geldigi ve Kullanim Kosullari onayi (KVKK / ispat icin).
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS signup_source text CHECK (signup_source IN ('self', 'operator')),
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS terms_version text;

-- Slug: ad yalnizca simgelerden olusuyorsa ('!!!') ikinci kayit '-2' gibi
-- bos onekli bir adres aliyordu; taban ad sabitlendi.
CREATE OR REPLACE FUNCTION public.set_business_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  base text;
  candidate text;
  suffix int := 1;
BEGIN
  IF new.slug IS NOT NULL AND new.slug <> '' THEN
    RETURN new;
  END IF;
  base := public.tr_slugify(new.name);
  IF base = '' THEN base := 'isletme'; END IF;
  candidate := base;
  WHILE EXISTS (SELECT 1 FROM public.businesses WHERE slug = candidate) LOOP
    suffix := suffix + 1;
    candidate := base || '-' || suffix::text;
  END LOOP;
  new.slug := candidate;
  RETURN new;
END;
$$;

-- E-postasini 7 gun icinde onaylamayan kendi kendine kayitlar silinir:
-- onaysiz hesapla giris yapilamadigi icin isletmede veri yoktur. Hesap
-- silinince profil kademeli gider, sonra profilsiz kalan isletme silinir.
CREATE OR REPLACE FUNCTION public.purge_unconfirmed_signups()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  WITH stale AS (
    SELECT u.id, p.business_id
    FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    JOIN public.businesses b ON b.id = p.business_id
    WHERE b.signup_source = 'self'
      AND u.email_confirmed_at IS NULL
      AND u.created_at < now() - interval '7 days'
  ),
  del_users AS (
    DELETE FROM auth.users u USING stale s WHERE u.id = s.id RETURNING s.business_id
  )
  DELETE FROM public.businesses b
  USING (SELECT DISTINCT business_id FROM del_users) d
  WHERE b.id = d.business_id
    AND b.signup_source = 'self'
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.business_id = b.id AND p.id NOT IN (SELECT id FROM stale));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_unconfirmed_signups() FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('purge-unconfirmed-signups')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-unconfirmed-signups');
SELECT cron.schedule('purge-unconfirmed-signups', '45 2 * * *', $$SELECT public.purge_unconfirmed_signups()$$);
