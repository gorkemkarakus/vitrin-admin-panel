-- "İptal edildi" (müşteri/işletme bilerek vazgeçti) ile "gelmedi" (randevu
-- saatinde müşteri hiç gelmedi, no-show) farklı olaylar — CRM segmentasyonu
-- ("sık iptal eden" vs "hiç gelmeyen") ve reklam ROAS hesabı bu ikisini
-- karıştırırsa yanlış çıkar. Var olan CHECK kısıtına yeni bir değer ekleniyor,
-- mevcut veri/davranış değişmiyor (sadece yeni bir değer artık geçerli).
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('bekliyor', 'onaylandi', 'tamamlandi', 'iptal', 'gelmedi'));
