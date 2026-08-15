-- Kullanici koltuk limiti kaldirildi/gevsetildi ama tamamen sinirsiz
-- birakmak yerine sabit 10 ile sinirlandiriliyor. Mevcut tum isletmelerin
-- max_users degeri 10'a yukseltiliyor, yeni isletmeler icin varsayilan da
-- 10 olarak guncellendi.
ALTER TABLE public.businesses ALTER COLUMN max_users SET DEFAULT 10;

UPDATE public.businesses SET max_users = 10 WHERE max_users < 10;
