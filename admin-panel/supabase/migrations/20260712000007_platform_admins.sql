-- =============================================================================
-- Operatör paneli için: tek bir işletmeye değil TÜM işletmelere erişebilen
-- platform yöneticileri. Mevcut profiles/my_business_id() sistemine HİÇ
-- dokunulmuyor — bu, tamamen bağımsız, ayrı bir yetki katmanı.
--
-- RLS etkin ve HİÇBİR client policy yok — "enabled + policy yok" Postgres'te
-- varsayılan-red demektir, yani service_role dışında (edge function'lar) hiç
-- kimse bu tabloyu okuyamaz/yazamaz, hatta kendi satırını bile.
-- =============================================================================
CREATE TABLE public.platform_admins (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
