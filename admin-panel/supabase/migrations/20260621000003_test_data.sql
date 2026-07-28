-- =============================================================================
-- VİTRİN — Test verisi (RLS izolasyonunu doğrulamak için)
-- =============================================================================
-- UYARI: Bu dosyayı sadece test ortamında çalıştır, PRODUCTION'da çalıştırma!
-- =============================================================================
-- KULLANIM:
-- 1. Önce bu SQL ile 2 işletme ve hizmetler oluştur.
-- 2. Supabase Dashboard → Authentication → Users üzerinden 4 kullanıcı oluştur:
--    - salon_admin@test.com  (şifre: Test1234!)
--    - salon_user@test.com   (şifre: Test1234!)
--    - studio_admin@test.com (şifre: Test1234!)
--    - studio_user@test.com  (şifre: Test1234!)
-- 3. Aşağıdaki ADIM 2 SQL'ini auth user ID'lerini doldurarak çalıştır.
-- =============================================================================

-- ── ADIM 1: İşletmeler ve hizmetler ──────────────────────────────────────
INSERT INTO public.businesses (id, name, slug) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Güzel Salon', 'guzel-salon'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Fit Studio',  'fit-studio')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.customers (id, business_id, full_name, phone) VALUES
  (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'Ayşe Kaya',    '5551110001'),
  (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'Fatma Demir',  '5551110002'),
  (gen_random_uuid(), 'bbbbbbbb-0000-0000-0000-000000000002', 'Mehmet Yılmaz','5552220001'),
  (gen_random_uuid(), 'bbbbbbbb-0000-0000-0000-000000000002', 'Ali Öztürk',   '5552220002');

INSERT INTO public.services (id, business_id, name, duration_minutes, price) VALUES
  (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'Manikür',              45, 250),
  (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'Pedikür',              60, 300),
  (gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'Fransız Manikür',      60, 350),
  (gen_random_uuid(), 'bbbbbbbb-0000-0000-0000-000000000002', 'Pilates (Bireysel)',   60, 500),
  (gen_random_uuid(), 'bbbbbbbb-0000-0000-0000-000000000002', 'Yoga (Grup)',          60, 200);

-- =============================================================================
-- ADIM 2: Auth kullanıcıları oluşturduktan sonra aşağıdaki SQL'i çalıştır.
-- Her UUID'yi Supabase Auth → Users ekranından kopyala.
-- =============================================================================
/*
INSERT INTO public.profiles (id, business_id, role, full_name) VALUES
  ('SALON_ADMIN_UUID',  'aaaaaaaa-0000-0000-0000-000000000001', 'admin', 'Salon Yöneticisi'),
  ('SALON_USER_UUID',   'aaaaaaaa-0000-0000-0000-000000000001', 'user',  'Salon Çalışanı'),
  ('STUDIO_ADMIN_UUID', 'bbbbbbbb-0000-0000-0000-000000000002', 'admin', 'Studio Yöneticisi'),
  ('STUDIO_USER_UUID',  'bbbbbbbb-0000-0000-0000-000000000002', 'user',  'Studio Çalışanı');
*/

-- =============================================================================
-- ADIM 3: Profiller oluştuktan sonra test randevuları ekle
-- =============================================================================
/*
-- Salon çalışanının randevusu
INSERT INTO public.appointments
  (business_id, customer_id, service_id, created_by_user_id, scheduled_at, source)
SELECT
  'aaaaaaaa-0000-0000-0000-000000000001',
  c.id,
  s.id,
  'SALON_USER_UUID',
  now() + interval '1 day',
  'kullanici_uzerinden'
FROM public.customers c, public.services s
WHERE c.business_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND c.full_name = 'Ayşe Kaya'
  AND s.business_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND s.name = 'Manikür'
LIMIT 1;

-- Studio çalışanının randevusu (farklı işletme — izole olmalı)
INSERT INTO public.appointments
  (business_id, customer_id, service_id, created_by_user_id, scheduled_at, source)
SELECT
  'bbbbbbbb-0000-0000-0000-000000000002',
  c.id,
  s.id,
  'STUDIO_USER_UUID',
  now() + interval '2 days',
  'reklam_instagram'
FROM public.customers c, public.services s
WHERE c.business_id = 'bbbbbbbb-0000-0000-0000-000000000002'
  AND c.full_name = 'Mehmet Yılmaz'
  AND s.business_id = 'bbbbbbbb-0000-0000-0000-000000000002'
  AND s.name = 'Yoga (Grup)'
LIMIT 1;
*/

-- =============================================================================
-- ADIM 4: RLS izolasyonunu doğrula
-- Her kullanıcıyla giriş yaptıktan sonra bu sorguları çalıştır:
-- Salon kullanıcısı Studio'nun verisini GÖRMEMELI.
-- =============================================================================
/*
-- Beklenen: sadece Güzel Salon'un müşterileri (Ayşe, Fatma)
SELECT full_name FROM public.customers;

-- Beklenen: sadece salon_user'ın randevuları (1 kayıt)
SELECT id, source, status FROM public.appointments;
*/
