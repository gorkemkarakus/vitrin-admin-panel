-- Chatbot, musteri "kadin/erkek calisan olsun" dedigin de calisanin gercek
-- cinsiyetini bilmedigi icin isim/unvana bakip TAHMIN ediyordu, hatta bazen
-- bu tahmini kesin bilgiymis gibi sunuyordu (test edilip dogrulandi: "Salon
-- Çalışanı" jenerik unvanina "evet, kendisi kadın" diye uydurma bir cevap
-- verdi). Gercek veri olmadigi surece bu risk prompt kurallariyla ancak
-- kismen azaltilabiliyor. Kalici cozum: calisanin kendi profilinde GERCEK
-- cinsiyetini secebilecegi bir alan.
--
-- Nullable birakildi: mevcut calisanlarin hicbiri bunu daha once secmedi,
-- NULL "belirtilmemis" anlamina gelir ve chatbot bu durumda hala eski
-- (tahmin + "kesin bilmiyorum" uyarisi) davranisina duser.
alter table public.profiles
  add column if not exists gender text check (gender in ('kadin', 'erkek'));

comment on column public.profiles.gender is 'Calisanin kendi belirttigi cinsiyeti (kadin/erkek) - chatbotun musteriye dogru/kesin cevap verebilmesi icin. NULL = belirtilmemis.';
