# Supabase kurulumu (Faz 4)

Bu adımları sen kendin yaparsın. Anahtarları sohbete yapıştırma.

1. https://supabase.com adresinde yeni bir proje oluştur (Dashboard → New project). Bölge olarak sana yakın bir yer seç (örneğin Frankfurt). Veritabanı şifresini bir şifre yöneticisine kaydet.
2. Dashboard → SQL Editor → New query. `supabase/migrations/0001_init.sql` dosyasının tamamını yapıştır ve Run'a bas. Hata çıkmamalı. Sonra Table Editor'da yedi `eng_` tablosunu ve her birinde "RLS enabled" yazısını gör.
3. Dashboard → Authentication → Sign In / Providers (eski adıyla Providers) bölümüne git. "Allow new users to sign up" seçeneğini kapat. Bu uygulama tek kullanıcılı; kayıt açık kalırsa herkes hesap açabilir.
4. Aynı yerde Email sağlayıcısının açık olduğunu kontrol et. Şifre yerine e-posta ile tek kullanımlık kod / magic link kullanacağız. "Confirm email" açık kalabilir.
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
