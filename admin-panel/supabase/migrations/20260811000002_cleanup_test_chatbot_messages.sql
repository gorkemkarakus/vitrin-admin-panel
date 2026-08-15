-- Temmuz ayında (curl/test script ile) gönderilmiş 5 test mesajı, Windows
-- terminalinin yanlış kod sayfası yüzünden Türkçe karakterleri (ü/ı/ç)
-- kalıcı olarak U+FFFD ile bozulmuş halde kaydetmişti — gerçek müşteri
-- mesajları/bot cevapları etkilenmedi, sadece bu 5 sentetik test-telefonu
-- (mobil-test-, blok-regresyon2-, desc-test2-, +905559998877) kaydı.
-- Bozuk kayıtlar silinip, doğru Türkçe karakterlerle birkaç temiz örnek
-- konuşma ile değiştiriliyor (Mesajlar ekranı artık nav'dan erişilebilir
-- olduğu için demo/test görünümü düzgün olsun diye).
DELETE FROM public.chatbot_messages WHERE id IN (
  '66c6f0fb-b40e-4492-ace4-5c99633b382c',
  '4dbdc71c-5844-4667-923a-b46087d78885',
  'a76da964-2e0e-4c0f-83c0-9950293e89e3',
  '75610a1f-9f5e-49ca-ba0a-3ee90254cf52',
  '482fe16a-734d-460c-96ed-90307d45b95e'
);

INSERT INTO public.chatbot_messages (business_id, customer_phone, role, content, created_at) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '+905551234567', 'user',      'Merhaba, saç boyama fiyatlarınız nedir?', now() - interval '3 hours'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '+905551234567', 'assistant','Merhaba! Saç boyama hizmetimiz 450 TL, süresi yaklaşık 90 dakika. Randevu almak isterseniz hangi gün ve saat uygun olur?', now() - interval '3 hours' + interval '30 seconds'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '+905551234567', 'user',      'Yarın saat 14:00 uygun, adım Ayşe Yılmaz, telefon 05551234567', now() - interval '3 hours' + interval '2 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '+905551234567', 'assistant','Randevunuz oluşturuldu ✅' || chr(10) || 'Saç Boyama - Yarın 14:00', now() - interval '3 hours' + interval '2 minutes' + interval '15 seconds'),

  ('aaaaaaaa-0000-0000-0000-000000000001', '+905559876543', 'user',      'Merhaba, manikür fiyatınız ne kadar ve ne kadar sürüyor?', now() - interval '1 hours'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '+905559876543', 'assistant','Merhaba! Manikür hizmetimiz 250 TL, süresi yaklaşık 45 dakika. Randevu almak isterseniz hangi tarih ve saat sizin için uygun olur?', now() - interval '1 hours' + interval '30 seconds'),

  ('aaaaaaaa-0000-0000-0000-000000000001', '+905553456789', 'user',      'Yarın öğleden sonra pedikür istiyorum', now() - interval '20 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '+905553456789', 'assistant','Tabii, pedikür hizmetimiz 300 TL, 45 dakika sürüyor. Tam adınızı ve telefon numaranızı alabilir miyim?', now() - interval '20 minutes' + interval '30 seconds'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '+905553456789', 'user',      'Zeynep Kaya, 05553456789', now() - interval '19 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '+905553456789', 'assistant','Randevunuz oluşturuldu ✅' || chr(10) || 'Pedikür - Yarın 15:00', now() - interval '19 minutes' + interval '15 seconds');
