-- gorkemmkrks@gmail.com hesabini (Dashboard'dan Authentication > Users > Add user
-- ile olusturuldu) operator paneline erisim yetkisi olan ilk platform admin yap.
INSERT INTO public.platform_admins (id)
SELECT id FROM auth.users WHERE email = 'gorkemmkrks@gmail.com'
ON CONFLICT DO NOTHING;
