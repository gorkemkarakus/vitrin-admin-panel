-- WhatsApp uzerinden personelin dogal dille randevu yazabilmesi icin:
-- 1) hangi telefon numarasinin hangi personele (ve dolayisiyla hangi
--    isletmeye) ait oldugunu cozmek icin profiles.whatsapp_phone
-- 2) cok-turlu onay/duzeltme akisinda bekleyen taslagi tutmak icin
--    staff_command_sessions (telefon basina TEK satir, her yeni mesajda
--    ustune yazilir — ayri bir suresi dolmus-satir temizligine gerek yok)

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS whatsapp_phone text;

-- Bos olmayan degerler arasinda essiz olsun (partial unique index), NULL'lar
-- serbest kalsin (coğu personel bu ozelligi hic kullanmayacak).
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_whatsapp_phone
  ON public.profiles (whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.staff_command_sessions (
  phone       text PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  draft       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- platform_admins/_app_secrets ile ayni desen: RLS acik, HICBIR client
-- policy yok — sadece service_role (edge function) erisebilir. Bu tabloda
-- musteri adi/telefonu gibi henuz onaylanmamis taslak veri duruyor, hicbir
-- kullaniciya dogrudan client'tan gorunmemeli.
ALTER TABLE public.staff_command_sessions ENABLE ROW LEVEL SECURITY;
