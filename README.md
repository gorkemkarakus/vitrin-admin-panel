# Vitrin

Güzellik salonları / randevu bazlı hizmet işletmeleri için Instagram & WhatsApp
otomasyon, randevu, muhasebe ve prim takip sistemi.

## Klasör yapısı

```
isletme_oto/
├── db/migrations/       PostgreSQL şeması (postgres ilk ayağa kalkışta otomatik çalıştırır)
├── n8n/flows/           İçe aktarılabilir n8n workflow JSON dosyaları
├── admin-panel/         React + Vite admin paneli (Faz 2'de kurulacak)
├── design-reference/    Referans tasarım dosyası (giris-teknolojik.html)
└── docker-compose.yml   n8n + PostgreSQL servisleri
```

## Faz 1 — Kurulum ve doğrulama

1. `.env.example` dosyasını `.env` olarak kopyalayın ve şifreleri değiştirin:
   ```
   cp .env.example .env
   ```

2. Servisleri ayağa kaldırın:
   ```
   docker compose up -d
   ```
   Postgres ilk defa ayağa kalkarken `db/migrations/` altındaki `.sql`
   dosyalarını sırayla (000, 001, 002...) otomatik çalıştırır. Şema daha
   sonra değiştirilirse (mevcut volume varken) bu dosyalar tekrar çalışmaz —
   yeni bir migration dosyası eklemek gerekir.

3. Şemanın kurulduğunu doğrulayın:
   ```
   docker exec -it vitrin_postgres psql -U vitrin -d vitrin -c "\dt"
   ```
   `customers, employees, services, appointments, conversations, messages, transactions`
   tablolarını listelemeli.

4. n8n arayüzüne gidin: http://localhost:5678 (`.env` içindeki basic auth
   bilgileriyle giriş yapın).

5. `n8n/flows/00-merhaba-webhook.json` dosyasını n8n arayüzünden
   **Import from File** ile içe aktarın, workflow'u **Active** yapın.

6. Webhook'u test edin:
   ```
   curl -X POST http://localhost:5678/webhook/merhaba
   ```
   Yanıt: `{"reply":"Merhaba! Vitrin asistanı ayakta 👋"}`

   Not: workflow "Active" değilse test etmek için önce n8n arayüzünde
   node'u seçip **Listen for test event** ile test URL'sini
   (`/webhook-test/merhaba`) kullanabilirsiniz.

## Notlar

- n8n kendi iç workflow/credential verisini varsayılan SQLite ile
  (`n8n_data` volume) tutuyor; işletme verisi (müşteri, randevu vb.) ayrı
  olarak Postgres'te (`vitrin` veritabanı) tutuluyor. n8n içindeki Postgres
  node/credential'ları bu veritabanına bağlanacak (host: `postgres`,
  container ağı üzerinden).
- Şema tasarımında `yön` alanı `messages` tablosunda ASCII uyumluluğu için
  `yon` olarak adlandırıldı.
- `customers.telefon` ve `customers.instagram_handle` için kısmi unique
  index'ler eklendi (NULL olabilir ama doluysa tekil olmalı) — Faz 3'teki
  "yeni/mevcut müşteri" ayrımı bu alanlar üzerinden yapılacak.
