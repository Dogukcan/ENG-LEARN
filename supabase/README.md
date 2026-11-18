# Supabase kurulumu (Faz 4)

Bu adımları sen kendin yaparsın. Anahtarları sohbete yapıştırma.

1. https://supabase.com adresinde yeni bir proje oluştur (Dashboard → New project). Bölge olarak sana yakın bir yer seç (örneğin Frankfurt). Veritabanı şifresini bir şifre yöneticisine kaydet.
2. Dashboard → SQL Editor → New query. Üç migration dosyasını bu sırayla, her birini ayrı bir sorguda çalıştır (içeriğin tamamını yapıştır, Run'a bas, hata çıkmamalı):
   - `supabase/migrations/0001_init.sql` (yedi tablo: kitap, gelen kutusu, kelime, kart, tekrar kaydı, etkinlik, ayarlar)
   - `supabase/migrations/0002_videos_speaking.sql` (üç tablo daha: video, konuşma oturumu, konuşma hatası; realtime satırları da burada)
   - `supabase/migrations/0003_sync_safety.sql` (eski bir sürümün yeni sürümü ezmesini engeller, ayar satırı id'sini hesaba bağlar, tetikleyici fonksiyonunu güvenli hale getirir)

   Sonra Table Editor'da on `eng_` tablosunu ve her birinde "RLS enabled" yazısını gör. İleride yeni bir `000N_*.sql` dosyası eklenirse aynı yoldan, sırayla çalıştırılır.
3. Dashboard → Authentication → Sign In / Providers (eski adıyla Providers) bölümüne git. "Allow new users to sign up" seçeneğini kapat. Bu uygulama tek kullanıcılı; kayıt açık kalırsa herkes hesap açabilir.
4. Aynı yerde Email sağlayıcısının açık olduğunu kontrol et. Şifre yerine e-posta ile tek kullanımlık kod kullanacağız. "Confirm email" açık kalabilir.
   - E-posta şablonunu düzelt (iPhone ana ekran uygulaması için şart): Authentication → Email Templates → "Magic Link" şablonunu aç. Şablonun gövdesine `{{ .Token }}` değişkenini ekle, örneğin: `<p>Giriş kodun: <strong>{{ .Token }}</strong></p>`. Bağlantı satırını (`{{ .ConfirmationURL }}`) silme; masaüstünde ikinci yol olarak çalışır.
   - Neden: iPhone'da ana ekrana eklenen uygulama Safari'den ayrı depolama kullanır. Maildeki bağlantı Safari'de açılır ve oturum uygulamaya geçmez. Kodu uygulamanın içindeki Hesap sayfasına yazınca giriş doğrudan uygulamada olur.
   - Kod 6 hanelidir (Authentication → Sign In / Providers → Email → "Email OTP Length" varsayılan 6; değiştirme).
   - Not: Supabase "Magic Link" şablonu hesap zaten varken kullanılır. Yeni kullanıcı kaydı kapalı olduğu için "Confirm signup" şablonuna dokunman gerekmez.
5. Kendi hesabını elle oluştur: Authentication → Users → Add user → Create new user. Kendi e-posta adresini yaz, "Auto Confirm User" kutusunu işaretle. (Kayıt kapalı olduğu için uygulama senin yerine hesap açamaz; kod `shouldCreateUser: false` kullanır.)
6. Authentication → URL Configuration:
   - Site URL: `http://localhost:5173`
   - Redirect URLs listesine ekle: `http://localhost:5173/**` ve Vercel adresin belli olunca `https://SENIN-ALAN-ADIN.vercel.app/**`
7. Project Settings → API sayfasından iki değeri kopyala: Project URL ve `anon` `public` anahtarı.
8. Proje klasöründe `.env.example` dosyasını `.env.local` olarak kopyala ve değerleri kendin yaz:

   VITE_SUPABASE_URL=Project URL değeri
   VITE_SUPABASE_ANON_KEY=anon anahtarı

9. `service_role` anahtarını asla kullanma, asla `.env.local` içine yazma ve asla tarayıcı koduna koyma. O anahtar tüm güvenlik kurallarını (RLS) aşar.
10. `.env.local` dosyası `.gitignore` içinde; yine de `git status` çıktısında görünmediğinden emin ol.
11. Vercel'e yayınlarken aynı iki değişkeni Vercel → Project Settings → Environment Variables bölümüne yaz.
