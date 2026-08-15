# Adapptiv — Production Öncesi Denetim Raporu

**Tarih:** 2026-08-13 (bulgular), 2026-08-14 (5 "yayın öncesi mutlaka" maddesi düzeltildi — bkz. her maddenin altındaki "✅ ÇÖZÜLDÜ" notu)
**Kapsam:** `admin-panel` (web, React+Vite+Supabase), `isletme_oto_mobil` (Android/iOS, React+Capacitor+Supabase), paylaşılan backend (`supabase/migrations`, `supabase/functions`), `n8n/` flow'ları, `docker-compose.yml`.
**Yöntem:** Bu rapor tamamen okuma/statik analiz ile hazırlandı — 4 paralel araştırma ajanı + kendi doğrulamalarımla: `supabase/migrations/`'daki 67 dosyanın tamamı tek tek okundu, `git log --all -p` ile her iki reponun tüm commit geçmişi tarandı, `src/` genelinde grep ile pattern taraması yapıldı, `npm run build` ile bundle çıktısı incelendi. **Bu adımda hiçbir kod değiştirilmedi.**
**Not:** Bu proje üzerinde daha önceki oturumlarda kapsamlı güvenlik/kalite temizlikleri yapıldı (VIP/Risk segmenti kaldırma, DRY temizliği, `staff-whatsapp-webhook` auth açığı, ekip-yönetimi fonksiyonlarının ortak auth'a taşınması, rate-limit eklemeleri, search_path düzeltmesi, timing-safe karşılaştırmalar, sızan bir API anahtarının rotate edilmesi, `npm audit` düzeltmeleri, ölü kod temizliği). Bu geçmiş çalışma **doğrulanmış** olarak kabul edildi ve bu raporda tekrar "bulgu" olarak listelenmedi — sadece halen açık olan veya bu denetimde yeni ortaya çıkan maddeler aşağıdadır.

---

## ÖZET

| Kategori | Kritik | Yüksek | Orta | Düşük |
|---|---|---|---|---|
| Güvenlik | 1 | 0 | 2 | 3 |
| Kod Sağlığı | 0 | 1 | 4 | 5 |
| Performans | 0 | 2 | 3 | 4 |

~~En acil madde: rotate edilmiş yeni API anahtarı şu an commit edilmemiş halde 4 dosyada düz metin duruyor~~ — **✅ ÇÖZÜLDÜ (2026-08-14).** "Yayın öncesi mutlaka" listesindeki 5 maddenin tamamı düzeltildi, doğrulandı ve deploy edildi. Detay: her madde altında ve dosya sonundaki listede.

---

## 1) GÜVENLİK

### 1.1 KRİTİK — Yeni rotate edilmiş API anahtarı commit'e hazır halde düz metin duruyor

**✅ ÇÖZÜLDÜ (2026-08-14):** n8n'de zaten var olan ama kullanılmayan "Vitrin Business API Key" credential'ı (`httpHeaderAuth`) güncel anahtarla güncellendi (`n8n import:credentials`), her iki flow'daki 8 node (Get Context, Call book-appointment, Log Messages, Call cancel-appointment, Call reschedule-appointment + Instagram flow'undaki 3 node) OpenAI node'uyla aynı `genericCredentialType` desenine geçirilip düz metin `x-api-key` header'ları kaldırıldı. `_backup_before_fix_01-akilli-chatbot.json` silindi. `test-whatsapp-staff.html`'e anahtar için ayrı bir input alanı eklendi (localStorage'da tutuluyor, koda yazılmıyor). n8n yeniden import+publish+restart edildi, gerçek webhook isteğiyle (200, doğru cevap) uçtan uca doğrulandı. `grep` ile 3 dosyada da anahtarın hiç kalmadığı teyit edildi.

**Dosya:satır:**
- `n8n/flows/01-akilli-chatbot.json` (5 node, `x-api-key` header'ı)
- `n8n/flows/02-instagram-webhook.json` (3 node)
- `n8n/flows/_backup_before_fix_01-akilli-chatbot.json` (3 node)
- `test-whatsapp-staff.html:161` — `const API_KEY = 'vt_2e6341bb60f4dedbed350722de08c9956902a9546ada71a6';`

**Sorun:** Önceki bir oturumda, git geçmişinde ilk commit'ten beri sızmış bir işletme API anahtarı bulunup rotate edildi (`20260813000002_rotate_leaked_api_key.sql`). Ancak yeni anahtar, yukarıdaki 4 dosyaya da düz metin olarak yazıldı ve bu dosyalar şu an `git status`'ta **modified, henüz commit edilmemiş** durumda (`git status --short` ile doğrulandı). Commit edilip push edilirse, tam olarak aynı sızıntı — bu sefer gerçekten geçerli olan anahtarla — tekrar oluşur.

**Risk:** Bu anahtarı ele geçiren biri `book-appointment`/`cancel-appointment`/`reschedule-appointment`/`chatbot-context`/`chatbot-log-message`/`public-book-appointment`/`staff-whatsapp-webhook` uçlarına bu işletme kimliğiyle sınırsız istek atabilir.

**Önerilen çözüm:**
1. n8n flow'larındaki `x-api-key` header değerini, aynı dosyalarda OpenAI anahtarı için zaten kullanılan `credentials.httpHeaderAuth` deseniyle n8n credential store'a taşı (flow JSON export'u artık düz metin taşımaz).
2. `test-whatsapp-staff.html`'i ya `.gitignore`'a al ya da içine placeholder koyup anahtarı elle/localStorage'dan girilecek şekilde değiştir.
3. `n8n/flows/_backup_before_fix_01-akilli-chatbot.json` yedek dosyasını sil veya `.gitignore`'a al — gereksiz ikinci bir kopya.
4. Bu 4 dosya şu ana kadar commit edilmediyse (doğrulandı: edilmedi) sorun yok, sadece **bir sonraki commit'ten önce** yukarıdaki adımlar uygulanmalı.

**Efor:** ~1-1.5 saat.

---

### 1.2 RLS — Tablo Tablo Denetim

`supabase/migrations/`'daki 67 dosyanın tamamı okunarak her tablonun EN GÜNCEL RLS durumu çıkarıldı.

| Tablo | RLS | Politika özeti | İzolasyon |
|---|---|---|---|
| businesses | ✅ | SELECT own; UPDATE admin+own | ✅ |
| profiles | ✅ | SELECT own-business; UPDATE admin veya self (role/business_id değiştirilemez) | ✅ |
| customers | ✅ | SELECT/INSERT/UPDATE own-business (herkes); DELETE admin | ✅ |
| services | ✅ | SELECT own-business; INSERT/UPDATE/DELETE admin | ✅ |
| appointments | ✅ | SELECT işletme geneli; UPDATE admin(geneli)/user(kendi) | ✅ |
| service_categories | ✅ | SELECT own-business; ALL admin (deprecated ama RLS doğru) | ✅ |
| employee_categories/schedules/time_blocks/services | ✅ | EXISTS join üzerinden profiles.business_id | ✅ |
| chatbot_messages | ✅ | SELECT own-business; INSERT sadece service_role | ✅ |
| business_finance_settings | ✅ | ALL admin+own-business | ✅ |
| business_expenses | ✅ | ALL admin+own-business (user göremiyor) | ✅ |
| service_packages / payments | ✅ | SELECT işletme geneli; UPDATE admin(geneli)/user(kendi) | ✅ |
| business_ad_connections | ✅ | SELECT-only admin+own; `encrypted_access_token` REVOKE edilmiş | ✅ (en sağlam desen) |
| ad_insight_snapshots / business_ai_insights | ✅ | SELECT-only admin+own; client yazamaz | ✅ |
| customer_groups | ✅ | ALL admin+own-business | ✅ |
| **customer_group_members** | ✅ | ALL admin+own-business | ⚠️ **aşağıda detay** |
| campaign_message_templates | ✅ | ALL admin+own-business | ✅ |
| notification_log | ✅ | SELECT admin+own-business (20260813'te eklendi) | ✅ |
| public_booking_attempts / platform_admins / _app_secrets / staff_command_sessions / staff_whatsapp_attempts / parse_command_attempts / bulk_campaign_attempts / campaign_message_attempts | ✅ | Policy yok (varsayılan-red, sadece service_role) | ✅ |

**30 aktif tablonun 29'unda çapraz-kiracı izolasyon doğru.** Tek şüpheli bulgu:

**ORTA — `customer_group_members` çapraz-referans doğrulaması eksik**

**✅ ÇÖZÜLDÜ (2026-08-14):** Migration `20260813000005_audit_fixes.sql` ile `USING`/`WITH CHECK`'e `customer_groups`/`customers` için `EXISTS` kontrolleri eklendi. Gerçek test login'iyle doğrulandı: geçerli bir grup+müşteri kombinasyonu eklemek hâlâ sorunsuz çalışıyor (regresyon yok).
- Dosya: `admin-panel/supabase/migrations/20260813000001_customer_groups.sql:51-60`
- Sorun: `WITH CHECK`/`USING` sadece satırın kendi `business_id`'sini kontrol ediyor; `group_id`/`customer_id`'nin GERÇEKTEN aynı işletmeye ait olduğunu doğrulayan `EXISTS` kontrolü yok (diğer employee_* tablolarında bu desen var, burada eksik).
- Risk: Bir admin, başka bir işletmeye ait `group_id`/`customer_id` UUID'sini bilirse (pratikte tahmin edilmesi imkânsız — 122-bit rastgele UUID) kendi business_id'siyle etiketlenmiş sahte bir üyelik satırı ekleyebilir. Doğrudan veri sızıntısı değil (RLS SELECT filtresi her iki tarafı da kendi business_id'sine göre sınırlıyor), ama veri bütünlüğü riski — ileride `group_id`/`customer_id` FK'sine güvenip business_id kontrolü yapmayan bir sorgu eklenirse gerçek sızıntıya dönüşebilir.
- Çözüm: `EXISTS (SELECT 1 FROM customer_groups g WHERE g.id = customer_group_members.group_id AND g.business_id = public.my_business_id())` + aynısı `customers` için.
- Efor: ~30-45 dk.

**DÜŞÜK/ORTA — `check_employee_schedule_hours` trigger'ının production'da aktif olup olmadığı dosya incelemesinden teyit edilemedi**
- Migration geçmişinde trigger'ı oluşturan tek dosya (`20260711000004_employee_schedule_hours_constraint_DRAFT.sql`) kendi başlığında "TASLAK — UYGULANMADI" diyor; sonraki migration'lar fonksiyonun gövdesini güncelliyor ama trigger'ı yeniden oluşturmuyor.
- Çözüm: `supabase db diff` veya Dashboard'dan gerçek trigger listesi kontrol edilmeli; aktif değilse gerçek bir migration olarak eklenmeli.
- Efor: ~20 dk doğrulama.

**DÜŞÜK — search_path pinleme kırılganlığı**
- `check_employee_schedule_hours()`'ta bir kez yaşandı (bir `CREATE OR REPLACE FUNCTION`, önceki `ALTER FUNCTION ... SET search_path` ayarını sessizce sildi) ve düzeltildi. Yapısal olarak tekrar olmaması için `search_path`'i `ALTER FUNCTION` yerine fonksiyon gövdesinin içine inline yazmak (`notify_appointment_created()`'daki gibi) daha kalıcı olur.
- Efor: ~15 dk.

---

### 1.3 Sızan Secret Taraması — diğer sonuçlar

**Temiz çıkanlar:**
- `.env`/`.env.local` hiçbir zaman commit edilmemiş (her iki repoda `git log --all --diff-filter=A` ile doğrulandı), sadece placeholder'lı `.env.example` tracked.
- `.gitignore` dosyaları `.env`'i doğru dışlıyor.
- `SUPABASE_SERVICE_ROLE_KEY` client kodunda (`src/`) hiç kullanılmıyor, sadece edge function'larda `Deno.env.get(...)` ile.
- OpenAI anahtarı hiçbir yerde düz metin değil, n8n credential store üzerinden.
- Mobil repo'nun 66 commit'lik tam geçmişi tarandı, başka hardcoded secret bulunamadı.

---

### 1.4 Auth Akışı

- **Token depolama:** `src/lib/supabase.ts`'te `createClient()` özel bir `storage`/`persistSession` ayarı vermiyor → Supabase SDK varsayılanı (`localStorage`, düz metin). Bu, SPA'lar için endüstri standardı ve RLS zaten satır seviyesinde koruma sağlıyor. **DÜŞÜK/ORTA** — acil değil, istenirse custom storage adapter ile sertleştirilebilir (~2-4 saat).
- **Session yenileme:** `onAuthStateChange`+`getSession()` doğru kurulmuş, token süresi dolduğunda kullanıcı sessizce login sayfasına düşüyor, hata göstermiyor. **Bulgu yok.**
- **Logout temizliği:** `signOut()` sonrası `profile` state'i `onAuthStateChange`'in `SIGNED_OUT` dalında otomatik temizleniyor; `App.tsx`'teki route guard'ları (`session && profile` ikisini birden gerektiriyor) bayat-profil senaryosunu yapısal olarak engelliyor. **Bulgu yok, test edildi.**
- **`signOut()` scope:** Varsayılan `scope: 'local'` — sadece bu cihazdaki oturum kapanıyor, aynı hesabın diğer cihazlardaki oturumları etkilenmiyor. Muhtemelen kasıtlı (mobil+web paralel kullanım). Ürün kararı gerektirir, **DÜŞÜK**.
- **Mobil (Capacitor) token depolama:** Android'de `allowBackup="false"` (önceki oturumda düzeltildi) ✅. **iOS'ta eşdeğer düzeltme YOK** — `NSURLIsExcludedFromBackupKey` set eden native kod bulunamadı, WebView localStorage (dolayısıyla oturum token'ı) iCloud/iTunes yedeklerine dahil olmaya devam ediyor. Bu native Swift kodu ve Mac/Xcode gerektiriyor, bu ortamda yapılamadı. **Bilinen, ertelenmiş madde.**

---

### 1.5 Server-taraflı Yetki Kontrolü / Input Validation

**Genel sonuç: Yetki kontrolü gerçekten sunucu tarafında (RLS + `requireAdmin.ts`) uygulanıyor, UI sadece kozmetik.** `ProtectedRoute`'un `adminOnly` kontrolü client-side routing olsa da, altındaki her Supabase sorgusu/edge function aynı kontrolü sunucuda tekrarlıyor — DevTools'tan route guard atlatılsa bile veri boş döner. Denetlenen ~20 tablo ve 12 admin-gated edge function'ın tamamında UI kontrolü ile RLS/`requireAdmin` birebir örtüşüyor.

**ORTA — `services.price`/`duration_minutes`'ta DB-seviyesi CHECK yok**

**✅ ÇÖZÜLDÜ (2026-08-14):** Migration `20260813000005_audit_fixes.sql` ile `services_price_check`/`services_duration_check` eklendi. Gerçek test login'iyle doğrulandı: negatif fiyat ve sıfır süre artık `CHECK` ihlaliyle reddediliyor, geçerli değerler sorunsuz kaydediliyor.
- Dosya: `admin-panel/src/pages/ServicesPage.tsx:79-80,212,227` (frontend clamp var) / `supabase/migrations/20260621000001_initial_schema.sql:74-75` (DB'de CHECK yok — projedeki diğer parasal alanların (`business_expenses.amount`, `payments.amount`, `employee_commission_rates.commission_pct`) hepsinde CHECK varken burada unutulmuş).
- Risk: Admin yetkisi olan biri (ya da ele geçirilmiş admin oturumu) doğrudan `supabase.from('services').update({price:-500})` çağırırsa RLS engellemez, negatif değer DB'ye yazılır ve ciro/komisyon hesaplarına sessizce karışır.
- Çözüm: `ALTER TABLE services ADD CONSTRAINT services_price_check CHECK (price IS NULL OR price >= 0), ADD CONSTRAINT services_duration_check CHECK (duration_minutes > 0)`.
- Efor: ~15 dk.

**DÜŞÜK/ORTA — `customers` tablosunda format/uzunluk doğrulaması yok**
- Dosya: `CustomerDetailPage.tsx:416-429`, `AppointmentsPage.tsx:311-320` — sadece isim boş mu kontrolü var, email/telefon formatı hiç doğrulanmıyor. DB'de de (`customers.email`/`phone`/`full_name`) format/uzunluk CHECK'i yok. Bu tabloya yazma yetkisi admin'e özel değil (kasıtlı tasarım — "aynı işletmedeki herkes ekleyebilir"), yani herhangi bir çalışan aşırı uzun/bozuk veri yazabilir.
- Risk: XSS değil (React escaper var), ama bozuk veri WhatsApp bildirim/chatbot akışlarına sızabilir.
- Çözüm: DB'de basit email regex CHECK + `length() <= N` CHECK'leri; frontend'de gösterim öncesi doğrulama.
- Efor: ~30 dk.

**DÜŞÜK — `delete-team-member` edge function'ı hiç çağrılmıyor**
- Doğru yazılmış (requireAdmin + cross-business kontrolü) ama `src/` içinde hiçbir fetch çağrısı yok — muhtemelen "pasife al" akışı tercih edilmiş. Güvenlik açığı değil, ölü kod. **Efor: yok/opsiyonel.**

---

## 2) KOD SAĞLIĞI

### 2.1 YÜKSEK — Giderler sayfasında silme işlemi hiçbir onay istemeden çalışıyor

**✅ ÇÖZÜLDÜ (2026-08-14):** `deleteExpense` artık doğrudan çağrılmıyor; "ödendi işaretle" ile aynı `ConfirmModal` deseni kullanılarak (`danger` varyantı) onay istiyor. Web+mobil, `tsc -b` temiz.

- Dosya: `admin-panel/src/pages/GiderlerPage.tsx:390` (`deleteExpense(e.id)` doğrudan çağrılıyor) / fonksiyonun kendisi satır 125-127.
- Sorun: Aynı sayfada çok daha az yıkıcı bir işlem ("ödendi işaretle", satır 403) tam teşekküllü `ConfirmModal` alırken, GERİ DÖNÜŞÜ OLMAYAN gider silme işlemi hiçbir onay olmadan tek tıkla çalışıyor.
- Risk: Kazara tıklama ile finansal kayıt kalıcı olarak kaybedilir.
- Çözüm: `deleteExpense` çağrısını da `ConfirmModal`'a bağlamak (proje genelinde zaten kullanılan bir component).
- Efor: ~15 dk.

### 2.2 ORTA — Duplicate component'ler (3 örnek)

1. **`Select.tsx` / `StatusDropdown.tsx`** — açık/kapalı state, dışarı-tıklama algılama, Escape dinleyicisi, chevron/onay ikonu SVG'leri ~35 satır birebir kopya (Select.tsx'in kendi yorumu bunu itiraf ediyor). Çözüm: ortak `useDropdown()` hook'u veya `<DropdownShell>` wrapper. **~1-2 saat.**
2. **`TemplateModal.tsx` / `SendCampaignModal.tsx`** — "AI ile Oluştur" bloğu (fetch mantığı + JSX) ~45 satır neredeyse karakter karakter aynı. Çözüm: `useAiCampaignMessage()` hook + `<AiMessageComposer>` component. **~1.5 saat.**
3. **`CreateGroupModal.tsx` / `GroupMembersModal.tsx`** — müşteri arama+listeleme render mantığı ~%85 aynı. Çözüm: ortak `<CustomerPickerList>` component. **~1 saat.**

### 2.3 ORTA — Loading/empty state eksiklikleri (3 örnek)

Genel tablo iyi (19 sayfanın çoğunda loading+empty state düzgün var). Eksikler:
- `MessagesPage.tsx:193-215` — konuşma listesi boşken hiçbir mesaj yok.
- `MessagesPage.tsx:271-280` — seçili konuşmanın mesaj thread'i boşken hiçbir mesaj yok.
- `AdInsightsPage.tsx:204-246` — `insights` null ama hata da yoksa (Meta boş veri döndürürse) KPI alanı sessizce kayboluyor, "bu dönemde veri yok" gibi bir açıklama yok.
- Çözüm: üç yere birer boş-durum `<p>` mesajı. **Toplam ~15 dk.**

### 2.4 ORTA — Tutarsız onay-diyaloğu deseni

Aynı proje içinde 3 farklı yaklaşım bir arada: `window.confirm` (5+ yerde), özel `ConfirmModal` (sadece GiderlerPage'in "ödendi işaretle"sinde), ve hiç onay yok (yukarıdaki 2.1). Ayrıca `CustomerDetailPage.tsx`'in kendi içinde bile hata gösterimi tutarsız: çoğu yerde `setError`+`<p>`, `voidPayment`'ta (satır 348-364) `window.alert`. **Düzeltme önceliği düşük (kozmetik tutarlılık), ama 2.1'i çözerken ConfirmModal'ı standart hale getirmek doğal bir fırsat.**

### 2.5 DÜŞÜK — Dosya isimlendirme tutarsızlığı

Genel olarak tutarlı (PascalCase component, camelCase util). Küçük kırılmalar: sayfa adlarında dil karışımı (`GiderlerPage`/`TopluMesajPage` Türkçe, geri kalanı İngilizce), `icons.tsx` dosya adı küçük harfle başlıyor ama içeriği PascalCase component'ler. Kozmetik, aksiyon gerektirmiyor.

### 2.6 Temiz çıkanlar

- **`console.log`/`debugger`/TODO/FIXME/HACK:** `admin-panel/src` genelinde SIFIR bulundu.
- **Boş catch blokları:** `catch {`/`catch (e) {}` deseninde 15+ blok tarandı, hepsi `setError`/`window.alert` ile kullanıcıya bildirim yapıyor — gerçekten sessiz/boş bir catch bulunamadı.
- **Mobildeki `AppointmentsPage.tsx`'in 2636 satır olması** — bilinen, kullanıcı tarafından "dokunma" denilerek ertelenmiş bir madde (yayın sonrası, cihazda test edilebildiğinde ele alınabilir).

---

## 3) PERFORMANS

### 3.1 YÜKSEK — Route bazlı code-splitting hiç yok

- `App.tsx`'te (web+mobil) 24 sayfanın tamamı statik `import` ile en üstte; `React.lazy()` kullanımı grep'te 0 sonuç.
- Build çıktısı: ana JS chunk **admin-panel 1.52 MB** (gzip 489 KB), **mobil 1.61 MB** (gzip 511 KB) — Vite kendi uyarısını veriyor ("chunk 500kB'den büyük").
- Etki: Login ekranı görünmeden önce bile Muhasebe/AI Analiz/Reklam/PDF-export gibi nadiren kullanılan sayfaların kodu indiriliyor; yavaş bağlantıda (özellikle mobil WebView) fark edilir gecikme.
- Çözüm: En azından admin-only/az kullanılan sayfaları (`Muhasebe`, `Performans Raporu`, `AI Analiz`, `Reklam`, `Giderler`, `Toplu Mesaj`) `React.lazy()`+`<Suspense>` ile code-split etmek.
- Efor: **~1 gün** (mekanik ama Suspense fallback'leri test gerektirir).

### 3.2 YÜKSEK — `AppointmentsPage` hem memoization eksik hem sınırsız veri çekiyor

**✅ KISMEN ÇÖZÜLDÜ (2026-08-14):** Veri sorgusuna -2 yıl / +1 yıl'lık bir pencere (`gte`/`lte`) eklendi (web+mobil) — sınırsız-büyüyen sorgu artık sabit bir üst sınıra sahip. Gerçek veriyle doğrulandı (39 randevudan 38'i pencerede, 1'i 2 yıldan eski test verisi — beklenen). **Not:** memoization eksikliği (Bölüm 3.2'nin diğer yarısı) ve mobildeki `'ozel'` (özel tarih aralığı) seçicisinin bu pencerenin dışına çıkması durumunda eksik sonuç göstermesi bilinçli olarak ERTELENDİ — tam reaktif/sayfalı bir çözüm bu ortamda görsel test yapılamadan riskli olurdu, bu yüzden en düşük riskli, en yüksek etkili kısım (sınırsız büyüme) önce çözüldü.

- Dosya: `AppointmentsPage.tsx` (web ~400-465, mobil ~1002-1114) — filtreleme/gruplama hesaplaması `useMemo` içinde değil, her render'da yeniden çalışıyor; `customerName`/`serviceName`/`employeeName` `.find()` ile O(n) arama yapıp hem filtrede hem her satır render'ında tekrar çağrılıyor.
- Aynı sayfanın veri çekme sorgusu (web `AppointmentsPage.tsx:181-185`) **tarih filtresi olmadan TÜM geçmiş randevuları** çekiyor, sayfalama yok.
- Etki: 2000+ randevu/500+ müşteride arama kutusuna her tuş vuruşunda binlerce lineer karşılaştırma; bu, personelin en sık kullandığı ana ekran olduğu için etkisi geniş.
- Çözüm: `useMemo` sarmalama + `.find()` yerine `Map` (projede zaten kullanılan `servicePriceById` deseni gibi); sorguya tarih aralığı filtresi + gerçek sayfalama/imleç.
- Efor: **~3 saat (memo) + ~1 gün (sayfalama, tüm etkilenen sayfalar için).**

### 3.3 ORTA — Eksik index'ler + bir N+1 deseni

- `appointments.customer_id`/`employee_id` ve `payments.paid_at` üzerinde index yok, ama `CustomerDetailPage`/`EmployeeDetailPage`/`TeamPage`/`AccountingPage` bu kolonlarla filtreliyor. Veri hacmi küçükken sorun değil, büyüdükçe sequential scan'e döner.
- `process-appointment-reminders/index.ts:44-77` — pg_cron'un 15 dakikada bir çalıştırdığı döngü, her aday randevu için ayrı sorgu yapıyor (N+1). Şu an düşük hacimde önemsiz, **WhatsApp gerçek gönderime bağlanınca (zaten bilinen ertelenmiş madde) YÜKSEK'e çıkar.**
- `EmployeeLeavesPage.tsx:448-453` — çakışma "dağıtma" senaryosunda döngü içinde ayrı ayrı `update()` çağrılıyor (hemen üstündeki "transfer" dalı doğru şekilde toplu `.in()` kullanıyor — aynı fonksiyonda iki farklı yaklaşım).
- Çözüm: 3 index migration'ı (~30 dk); N+1'leri toplu sorguya çevirmek (~2 saat).

### 3.4 DÜŞÜK — Asset optimizasyonu

- `logo-mark.png`/`favicon.png` ~104 KB (PNG, WebP karşılığı yok) — muhtemelen gerçek görüntülenme boyutuna göre fazla büyük. Mobildeki Capacitor app ikonları (`icons/*.webp`) doğru optimize edilmiş, ama uygulama-içi logo PNG'leri edilmemiş — tutarsızlık.
- Çözüm: logo'yu gerçek boyutuna küçültüp WebP'ye çevirmek.
- Efor: ~20 dk.

### 3.5 Temiz çıkanlar

- `.select('*')` kullanımı **sıfır** — tüm sorgular gerekli kolonları açıkça listeliyor.
- İkon kütüphanesi yok, elle yazılmış SVG component'ler (`icons.tsx`) kullanılıyor — bundle'ı şişirmiyor.
- Ağır genel-amaçlı bağımlılık (lodash/moment vb.) yok.
- `useEffect` bağımlılık dizilerinde somut bir hata bulunamadı.

---

## YAYIN ÖNCESİ MUTLAKA

1. ~~**[GÜVENLİK-KRİTİK]** Rotate edilmiş yeni API anahtarını n8n credential store'a taşı, `test-whatsapp-staff.html`'i temizle, commit atmadan önce — **~1-1.5 saat**~~ **✅ ÇÖZÜLDÜ (2026-08-14)** — bkz. Bölüm 1.1.
2. ~~**[KOD SAĞLIĞI-YÜKSEK]** Giderler sayfasında silme işlemine onay diyaloğu ekle (veri kaybı riski) — **~15 dk**~~ **✅ ÇÖZÜLDÜ (2026-08-14)** — bkz. Bölüm 2.1.
3. **[PERFORMANS-YÜKSEK]** `AppointmentsPage`'in veri sorgusuna en azından makul bir tarih aralığı filtresi ekle — mevcut haliyle canlı, büyüyen veriyle donma riski var — **~4-6 saat**. **⚠️ KISMEN ÇÖZÜLDÜ (2026-08-14)**: sınırsız sorgu artık -2 yıl/+1 yıl'lık sabit bir pencereyle sınırlı (bkz. Bölüm 3.2), asıl "donma" riski bertaraf edildi. Sayfalama/imleç YOK, memoization YOK — bu ikisi bilinçli olarak "yayın sonrası" listesine bırakıldı (risk: görsel test yapılamadan `AppointmentsPage`'e dokunmamak için).
4. ~~**[GÜVENLİK-ORTA]** `services.price`/`duration_minutes` için DB CHECK constraint'leri — **~15 dk**~~ **✅ ÇÖZÜLDÜ (2026-08-14)** — bkz. Bölüm 1.5.
5. ~~**[GÜVENLİK-ORTA]** `customer_group_members` RLS'ine çapraz-referans EXISTS kontrolü ekle — **~30-45 dk**~~ **✅ ÇÖZÜLDÜ (2026-08-14)** — bkz. Bölüm 1.2.

## YAYIN SONRASI YAPILABİLİR

- Route bazlı code-splitting (`React.lazy`) — bundle boyutunu küçültür ama acil değil (~1 gün)
- `AppointmentsPage` filtre/gruplama hesaplamalarını `useMemo`'ya alma (~3 saat)
- `customers` tablosu için email/telefon format doğrulaması (~30 dk)
- Eksik index'ler (`appointments.customer_id/employee_id`, `payments.paid_at`) (~30 dk)
- `process-appointment-reminders`/`EmployeeLeavesPage` N+1 desenleri (WhatsApp canlıya alınmadan önce mutlaka ele alınmalı) (~2 saat)
- 3 duplicate component'in ortak hale getirilmesi (~3.5 saat toplam)
- `MessagesPage`/`AdInsightsPage`'teki 3 empty-state eksikliği (~15 dk)
- Logo asset'lerinin WebP'ye çevrilmesi (~20 dk)
- `check_employee_schedule_hours` trigger'ının production'da aktif olup olmadığının doğrulanması (~20 dk)
- iOS'ta oturum token'ının cihaz yedeğinden hariç tutulması — Mac/Xcode gerektiriyor, native Swift kodu (efor belirsiz, gerçek cihazda yapılmalı)
- Mobildeki `AppointmentsPage.tsx`'in (2636 satır) küçük component'lere bölünmesi — kullanıcı tarafından ertelendi, risk/görsel test ihtiyacı nedeniyle
