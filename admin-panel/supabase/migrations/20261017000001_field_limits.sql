-- Metin alanlari icin uzunluk, para alanlari icin isaret, e-posta/telefon icin
-- bicim kisitlari. Istemcideki sinirlar (src/lib/fieldLimits.ts) ayni listeden
-- gelir; buradaki kisitlar dogrudan API ile gelen istekleri de keser.
-- Eklenmeden once mevcut verinin tamami bu kurallara uydugu dogrulandi.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('appointments', 'chk_appointments_notes_len', 'char_length(notes) <= 1000'),
    ('appointments', 'chk_appointments_source_note_len', 'char_length(source_note) <= 300'),
    ('business_expenses', 'chk_business_expenses_category_len', 'char_length(category) <= 60'),
    ('business_expenses', 'chk_business_expenses_description_len', 'char_length(description) <= 200'),
    ('business_holidays', 'chk_business_holidays_name_len', 'char_length(name) <= 100'),
    ('businesses', 'chk_businesses_name_len', 'char_length(name) <= 120'),
    ('campaign_message_templates', 'chk_campaign_message_templates_message_len', 'char_length(message) <= 1000'),
    ('campaign_message_templates', 'chk_campaign_message_templates_title_len', 'char_length(title) <= 120'),
    ('cash_closures', 'chk_cash_closures_note_len', 'char_length(note) <= 1000'),
    ('customer_groups', 'chk_customer_groups_description_len', 'char_length(description) <= 300'),
    ('customer_groups', 'chk_customer_groups_name_len', 'char_length(name) <= 80'),
    ('customers', 'chk_customers_contact_phone_len', 'char_length(contact_phone) <= 32'),
    ('customers', 'chk_customers_email_len', 'char_length(email) <= 254'),
    ('customers', 'chk_customers_full_name_len', 'char_length(full_name) <= 120'),
    ('customers', 'chk_customers_notes_len', 'char_length(notes) <= 2000'),
    ('customers', 'chk_customers_phone_len', 'char_length(phone) <= 64'),
    ('employee_time_blocks', 'chk_employee_time_blocks_label_len', 'char_length(label) <= 80'),
    ('payments', 'chk_payments_note_len', 'char_length(note) <= 300'),
    ('profiles', 'chk_profiles_full_name_len', 'char_length(full_name) <= 120'),
    ('profiles', 'chk_profiles_whatsapp_phone_len', 'char_length(whatsapp_phone) <= 32'),
    ('service_categories', 'chk_service_categories_name_len', 'char_length(name) <= 80'),
    ('service_packages', 'chk_service_packages_note_len', 'char_length(note) <= 500'),
    ('services', 'chk_services_description_len', 'char_length(description) <= 2000'),
    ('services', 'chk_services_name_len', 'char_length(name) <= 80'),
    ('customers', 'chk_customers_email_format', $f$email IS NULL OR email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'$f$),
    ('customers', 'chk_customers_contact_phone_format', $f$contact_phone IS NULL OR contact_phone ~ '^[0-9+() -]+$'$f$),
    ('services', 'chk_services_price_nonneg', 'price IS NULL OR price >= 0'),
    ('payments', 'chk_payments_amount_pos', 'amount > 0'),
    ('business_expenses', 'chk_business_expenses_amount_nonneg', 'amount >= 0')
  ) AS v(tbl, name, expr)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.name) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%s)', r.tbl, r.name, r.expr);
    END IF;
  END LOOP;
END $$;
