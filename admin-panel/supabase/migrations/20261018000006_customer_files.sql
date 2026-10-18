-- Musteri dosyalari: oncesi / sonrasi fotograflari, onam formlari, belgeler.
-- Ozel depolama alani: yol "<business_id>/<customer_id>/<dosya>"; her isletme
-- yalnizca kendi klasorune erisir. Fotograflar kisisel veridir (KVKK);
-- "kisisel verilerini sil" bu dosyalari da kaldirir (istemci depolamadan
-- siler, anonymize_customer kayitlari siler).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('customer-files', 'customer-files', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS customer_files_read ON storage.objects;
CREATE POLICY customer_files_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'customer-files' AND (storage.foldername(name))[1] = public.my_business_id()::text);

DROP POLICY IF EXISTS customer_files_insert ON storage.objects;
CREATE POLICY customer_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'customer-files' AND (storage.foldername(name))[1] = public.my_business_id()::text);

DROP POLICY IF EXISTS customer_files_delete ON storage.objects;
CREATE POLICY customer_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'customer-files'
    AND (storage.foldername(name))[1] = public.my_business_id()::text
    AND (owner = auth.uid() OR public.my_role() = 'admin')
  );

CREATE TABLE IF NOT EXISTS public.customer_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  path text NOT NULL UNIQUE,
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  mime text NOT NULL,
  size_bytes int NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  kind text NOT NULL DEFAULT 'diger' CHECK (kind IN ('oncesi', 'sonrasi', 'onam', 'belge', 'diger')),
  note text CHECK (note IS NULL OR char_length(note) <= 300),
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Yol isletme ve musteri klasorunde olmali (depolama kurallariyla ayni).
  CHECK (path LIKE business_id::text || '/' || customer_id::text || '/%')
);
CREATE INDEX IF NOT EXISTS customer_files_customer_idx ON public.customer_files (customer_id, created_at DESC);
ALTER TABLE public.customer_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_files FROM anon;
GRANT SELECT, INSERT, DELETE ON public.customer_files TO authenticated;

DROP POLICY IF EXISTS customer_files_select ON public.customer_files;
CREATE POLICY customer_files_select ON public.customer_files
  FOR SELECT TO authenticated USING (business_id = public.my_business_id());
DROP POLICY IF EXISTS customer_files_insert_row ON public.customer_files;
CREATE POLICY customer_files_insert_row ON public.customer_files
  FOR INSERT TO authenticated
  WITH CHECK (
    business_id = public.my_business_id()
    AND uploaded_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.business_id = public.my_business_id())
  );
DROP POLICY IF EXISTS customer_files_delete_row ON public.customer_files;
CREATE POLICY customer_files_delete_row ON public.customer_files
  FOR DELETE TO authenticated
  USING (business_id = public.my_business_id() AND (uploaded_by = auth.uid() OR public.my_role() = 'admin'));

-- KVKK silme: dosya kayitlari da gider (depolamadaki dosyalari istemci siler).
CREATE OR REPLACE FUNCTION public.anonymize_customer(p_customer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business uuid;
  v_phone text;
  v_contact text;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Sadece yönetici yapabilir' USING ERRCODE = '42501';
  END IF;
  SELECT business_id, phone, contact_phone INTO v_business, v_phone, v_contact
  FROM public.customers WHERE id = p_customer_id AND business_id = public.my_business_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Müşteri bulunamadı' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.customers
  SET full_name = 'Silinmiş müşteri',
      phone = NULL,
      contact_phone = NULL,
      email = NULL,
      notes = NULL,
      bot_paused_until = NULL,
      marketing_consent = false,
      birthday = NULL,
      source = NULL,
      tags = '{}',
      custom_fields = '{}'::jsonb
  WHERE id = p_customer_id;

  DELETE FROM public.customer_group_members WHERE customer_id = p_customer_id;
  DELETE FROM public.customer_activities WHERE customer_id = p_customer_id;
  DELETE FROM public.tasks WHERE customer_id = p_customer_id;
  DELETE FROM public.customer_files WHERE customer_id = p_customer_id;

  UPDATE public.notification_log
  SET phone = NULL,
      message = '[kişisel veri silindi]'
  WHERE customer_id = p_customer_id;

  DELETE FROM public.chatbot_messages
  WHERE business_id = v_business AND customer_phone IN (v_phone, v_contact);
END;
$$;
REVOKE ALL ON FUNCTION public.anonymize_customer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.anonymize_customer(uuid) TO authenticated;
