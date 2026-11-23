# Faz 4 öğrenme notu: Supabase, giriş, güvenlik kuralları ve eşitleme motoru

Bu fazda uygulamaya bir bulut kısmı ekledik. Artık verin telefonda ve bilgisayarda aynı olabilir.
Ama uygulama hâlâ önce çevrimdışı çalışır. Asıl veri yine tarayıcıdaki IndexedDB'de durur.
Bulut sadece bir kopya ve bir köprü görevi görür.

Bu fazda yeni bir programlama dili öğrenmen gerekmiyor. Kodun büyük kısmı yine TypeScript.
Yeni olan tek dil SQL. SQL, veritabanıyla konuşma dilidir. Onu `supabase/migrations/` klasöründe göreceksin.

## Kullanılan teknolojiler ve bu projedeki rolleri

- **Supabase**: Hazır bir bulut servisi. İçinde veritabanı, giriş sistemi ve canlı bildirim var.
  Kendi sunucunu yazmak yerine Supabase'i kullandık. Bu yüzden uygulamanın hâlâ kendi sunucusu yok.
- **PostgreSQL (Postgres)**: Supabase'in içindeki veritabanı. IndexedDB'ye benzer ama bulutta durur
  ve tablolar halinde çalışır. Her tabloyu SQL ile tanımlarız. Tablolarımızın adı `eng_` ile başlar.
- **SQL migration dosyası**: Veritabanı yapısını tarif eden numaralı SQL dosyası. Dosyaları sırayla
  çalıştırırsın: `0001`, `0002`, `0003`. Böylece yapı adım adım ve tekrarlanabilir kurulur.
- **Supabase Auth**: Giriş sistemi. Şifre kullanmıyoruz. E-postana 6 haneli bir kod gelir, onu yazarsın.
- **Row Level Security (RLS)**: "Satır düzeyinde güvenlik". Veritabanı her satır için "bu kişi bunu
  görebilir mi?" diye sorar. Bizde cevap şu: sadece satırın sahibi görebilir.
- **Supabase Realtime**: Bir tabloda değişiklik olunca açık uygulamalara haber veren kanal.
  Bir cihazda kelime eklersen diğer cihaz bunu hemen duyar.
- **`@supabase/supabase-js` 2.119.1**: Tarayıcı kodunun Supabase ile konuştuğu kütüphane.
- **Sync engine (eşitleme motoru)**: Bizim yazdığımız kod. IndexedDB ile Supabase'i birbirine eşitler.
- **`.env.local`**: Gizli ayarların durduğu yerel dosya. Git'e girmez.

## Dosya haritası

- `supabase/migrations/0001_init.sql`: Yedi tablo (kitap, gelen kutusu, kelime, kart, tekrar kaydı,
  etkinlik, ayarlar), güvenlik kuralları ve realtime listesi.
- `supabase/migrations/0002_videos_speaking.sql`: Üç tablo daha (video, konuşma oturumu, konuşma hatası).
- `supabase/migrations/0003_sync_safety.sql`: Eski bir kopyanın yeni veriyi ezmesini engelleyen
  `client_updated_at` sütunu ve tetikleyici.
- `supabase/README.md`: Supabase'i sıfırdan kurma adımları. Bunları sen kendin yaparsın.
- `.env.example`: Hangi gizli ayarların gerektiğini gösteren boş şablon. İçinde değer yok.
- `src/lib/supabase.ts`: Supabase istemcisini oluşturur. Ayar yoksa `null` verir.
- `src/features/auth/session.ts`: Giriş fonksiyonları: kod gönder, kodu doğrula, çıkış yap.
- `src/features/sync/engine.ts`: Eşitleme motoru. Fazın kalbi.
- `src/features/sync/mapping.ts`: Yerel alan adlarını (`shortName`) sunucu sütunlarına (`short_name`)
  çevirir. Hangi store'un hangi tabloya gittiğini de burada yazar.
- `src/features/sync/runtime.ts`: Motoru gerçek depoya ve Supabase'e bağlar, kullanıcıyı takip eder.
- `src/features/sync/useSync.ts`: React ekranlarının motorun durumunu okuduğu iki küçük kanca (hook).
- `src/features/hesap/AccountSheet.tsx`: Hesap butonu ve altından açılan hesap sayfası.
- `src/features/hesap/accountView.ts`: Hesap sayfasında hangi görünümün çıkacağına karar veren saf kurallar.
- `src/data/indexeddb.ts`: Yerel veritabanı. Soft delete ve `applyRemote` burada.
- `src/features/sync/engine.test.ts`: Motorun testleri.

## Veri nereden gelir, nereye gider

Ekranlar hâlâ sadece `repository` ile konuşur. Eşitleme ekranların arkasında, ayrı çalışır.

1. Bir kelime eklersin. Kayıt IndexedDB'ye yazılır. Anında görünür. İnternet gerekmez.
2. Motor bu yerel değişikliği fark eder. 2 saniye bekler (`engine.ts:139`), çünkü art arda
   yazılan kayıtlar tek turda gitsin istiyoruz.
3. Motor bir "tur" başlatır (`round`, `engine.ts:377`). Tur, her store için önce **push**, sonra
   **pull** yapar. Sıra `SYNC_ORDER` listesinde yazılı (`mapping.ts:91`).
4. Push: yerelde değişen satırlar Supabase tablosuna gönderilir (`engine.ts:261`).
5. Pull: sunucuda değişen satırlar indirilir ve yerel veritabanına işlenir (`engine.ts:328`).
6. Başka bir cihaz bir şey değiştirirse Realtime kanalı haber verir (`engine.ts:444`).
   Motor 500 milisaniye sonra yeni bir tur başlatır.

Motor şu durumlarda da tur başlatır: giriş yaptığında, internet geri geldiğinde (`online` olayı) ve
uygulama sekmesi tekrar görünür olduğunda (`engine.ts:521-526`).

Giriş akışı: `AccountSheet.tsx` e-postanı alır → `signInWithEmail` kodu yollar
(`session.ts:33`) → sen kodu yazarsın → `verifyEmailCode` doğrular (`session.ts:56`) →
`runtime.ts:56` satırındaki dinleyici giriş değişikliğini duyar → `syncEngine.setUser` çağrılır
(`runtime.ts:52`) → motor ilk turu başlatır.

## Yeni kavramlar

### 6 haneli e-posta kodu (OTP)
OTP "one-time password" demektir: tek kullanımlık şifre. Şifre belirlemezsin. Supabase mail atar,
sen kodu yazarsın. Kod `verifyEmailCode` içinde kontrol edilir (`session.ts:65`).
Neden link yerine kod? iPhone'da ana ekrana eklenen uygulama Safari'den ayrı depolama kullanır.
Maildeki link Safari'de açılır. Oturum uygulamaya geçmez. Kodu uygulamanın içine yazarsan giriş
doğrudan uygulamada olur (açıklama `session.ts:50-55`).
Ayrıca `shouldCreateUser: false` var (`session.ts:44`). Yani yabancı biri bu yolla hesap açamaz.
Hesabı sen Supabase panelinden elle açtın (`supabase/README.md` madde 5).

### Row Level Security politikaları
Her tabloda RLS açık: `alter table ... enable row level security` (örnek: `0001_init.sql:44`).
Her tabloya dört politika yazdık: oku, ekle, güncelle, sil. Hepsi aynı şartı koyar:
`auth.uid() = user_id` (örnek: `0001_init.sql:46-53`). Yani "giriş yapan kişinin kimliği,
satırın sahibiyle aynı olmalı".
`anon` rolü (giriş yapmamış kişi) için bilerek hiç politika yok (yorum: `0001_init.sql:42-43`).
Kural yoksa erişim de yok. Giriş yapmamış biri hiçbir şey göremez ve değiştiremez.
`user_id` sütunu `default auth.uid()` ile dolar (`0001_init.sql:25`). İstemci bu alanı hiç göndermez.

### Soft delete ve `updatedAt`
Soft delete: Bir satırı gerçekten silmek yerine `deleted_at` alanına zaman yazmak.
Gerçekten silersen diğer cihaz "bu satır silindi" bilgisini asla öğrenemez. Satır kalırsa öğrenir.
Silinmiş satıra "mezar taşı" (tombstone) diyoruz. Yerelde bunu `tombstone` fonksiyonu yapar
(`indexeddb.ts:488`). Örnek kullanım: gelen kutusundan kelime silme (`indexeddb.ts:875-877`).
Dosyanın başındaki yorum da bunu söyler (`indexeddb.ts:20-21`).
`updatedAt`: Satırın son değişme zamanı. Eşitleme "hangi satır yeni?" sorusunu bununla cevaplar.
IndexedDB'de her store'da `by-updatedAt` indeksi var (`indexeddb.ts:194`). Sunucuda bu alanı bir
tetikleyici (trigger) doldurur: `eng_set_updated_at` (`0001_init.sql:12-20`, sonra `0003_sync_safety.sql:27`).
Tetikleyici, bir tabloda olay olunca otomatik çalışan veritabanı fonksiyonudur.
Cihazın saatine güvenmiyoruz. Saat yanlış olabilir.
Kısmi unique indeks: `where deleted_at is null` (örnek: `0001_init.sql:74`). Silinmiş bir kelime,
aynı kelimeyi tekrar eklemeni engellemez. Kural sadece yaşayan satırlara uygulanır.

### Last write wins (son yazan kazanır)
İki cihaz aynı satırı değiştirirse zamanı daha yeni olan kazanır. Yerelde bu karar `applyRemote`
içinde verilir: yerel kayıt eşit ya da daha yeniyse sunucudan gelen atlanır (`indexeddb.ts:1414-1418`).
Dikkat: bu "son gönderen" demek değildir, "son değiştiren" demektir.
Bu ayrımın neden gerektiğini bir sonraki başlıkta göreceksin.

### `client_updated_at` ve tetikleyici
Sorun: Bir cihaz kapalıydı ve eski bir kopya tutuyordu. Açılınca eski kopyayı gönderdi.
Sunucu bunu "şimdi geldi" diye damgaladı ve yeni düzenlemenin üstüne yazdı.
Çözüm: İstemci her satırla birlikte kendi düzenleme zamanını `client_updated_at` olarak yollar
(`mapping.ts:143`). Tetikleyici şunu kontrol eder: bu zaman satırın sunucudaki `updated_at` değerinden
eskiyse yazma geçersizdir. Bu durumda tetikleyici `return old` der ve satır olduğu gibi kalır
(`0003_sync_safety.sql:36-38`). Gönderen, bir sonraki pull'da daha yeni satırı alır.

### Push ve pull
- **Push**: Yerel değişiklikleri sunucuya yükler. Satırlar `upsert` ile gider (`engine.ts:286`).
  Upsert "yoksa ekle, varsa güncelle" demektir. Büyük liste 200'lük parçalara bölünür (`engine.ts:105`).
- **Pull**: Sunucudaki yeni satırları indirir ve `applyRemote` ile yerele işler (`engine.ts:352`).
- Her store için ayrı iki imleç (cursor) vardır, yani "nerede kaldım" işareti:
  `push.<store>` ve `pull.<store>` (`engine.ts:217-218`). İmleçler `localStorage`'da saklanır.
- Pull, imleçten 2 saniye geriden başlar (`PULL_OVERLAP_MS`, `engine.ts:107`). Çünkü yavaş bir
  işlem geç kaydedilmiş olabilir ve kaçırmak istemiyoruz.

### Keyset paging
Çok satırı bir seferde çekmeyiz. 1000'erlik sayfalar çekeriz (`engine.ts:104`).
Offset yöntemi "ilk 1000'i atla, sonrakini ver" der. Arada veri değişirse satır kaçar.
Keyset yöntemi "şu satırdan sonrakini ver" der. Sıralama `updated_at`, sonra `id` iledir
(`engine.ts:342-347`). `id` gerekli, çünkü tek push'taki birçok satır aynı `updated_at` değerini alır.
Her sayfadan sonra imleç kaydedilir (`engine.ts:362`). Üçüncü sayfa hata verirse ilk ikisi kaybolmaz.

### Echo (yankı)
Pull ile gelen bir satır yerelde de "değişmiş" görünür. Motor bunu tekrar push ederse sunucu
`updated_at` değerini yeniden artırır. Biz bunu tekrar çekeriz. Sonsuz döngü olur.
Çözüm: Zaten sunucuda olan satırların listesi tutulur: `echoCache` (`engine.ts:189`).
Push'ta bu satırlar atlanır (`engine.ts:275`). Bu liste `localStorage`'a kaydedilir (`engine.ts:204`),
çünkü sadece bellekte tutulsaydı yeniden başlatınca boşalırdı.

### Unique çakışması (23505)
İki cihaz çevrimdışıyken aynı kelimeyi farklı `id` ile ekleyebilir. Sunucuda "aynı kelime iki kez
olmaz" kuralı var. İkinci push Postgres hata kodu `23505` ile reddedilir.
Motor önce 200'lük parçayı dener. Hata satıra özgüyse satırları tek tek gönderir (`engine.ts:294-304`),
böylece bir kötü satır diğer 199'u engellemez.
Sonra `adoptServerTwin` sunucudaki ikizi bulur (`engine.ts:243`). Sunucudaki satır kazanır.
Yerel ikiz mezar taşına dönüşür. Hangi sütuna bakılacağı `UNIQUE_COLUMNS` içinde yazılı (`mapping.ts:109`).

### Hesap sayfası ve kullanıcı değiştirme
Hesap butonu ve sayfası `AccountSheet.tsx` içinde (`AccountButton`, satır 25). Hangi görünümün
çıkacağını `accountPanel` seçer (`accountView.ts:22`): kapalı, çıkış yapmış, kod gönderildi, giriş
yapmış, bekleyen değişiklik var, hata ya da "switch".
"Switch" durumu şöyle doğar: Bu cihazda A hesabının verisi var, sen B hesabıyla giriş yaptın.
Motor B'nin verisini sormadan yüklemez. `setUser` bunu fark eder ve eşitlemeyi durdurur (`engine.ts:480-489`).
Hesap sayfası sana iki seçenek sunar (`AccountSheet.tsx:306-322`):
- **Sil**: Yerel veri silinir, B'nin verisi indirilir.
- **Yükle**: Yerel veri B hesabına yüklenir.
Seçim `confirmUserSwitch` çağrısıyla motora gider (`engine.ts:497`, `AccountSheet.tsx:168`).
İmleçler her hesaba özel olduğu için seçimden sonra sıfırlanır (`resetCursors`, `engine.ts:208`).
Yoksa yeni hesabın eski satırları hiç indirilmezdi.
Not: Ayar kaydının sunucu `id` değeri artık hesabın kullanıcı kimliğidir (`mapping.ts:140-142`,
`0003_sync_safety.sql:45`). Aksi halde ikinci hesap ayarlarını kaydedemezdi.

### Güvenlik seçimleri
- **Sadece anon anahtarı**: `src/lib/supabase.ts:7-8` bunu söyler. Anon anahtarı tarayıcıda durabilir,
  çünkü yetkiyi RLS belirler. Anahtar tek başına veriye erişim vermez.
- **`service_role` anahtarı asla kullanılmaz**. O anahtar RLS'i aşar (`supabase/README.md` madde 9).
- **`.env.local`**: Anahtarlar burada durur. `.gitignore` bunu dışarıda bırakır (`.gitignore:7-8`).
  Sadece boş şablon `.env.example` git'e girer (`.gitignore:9`).
- **Kayıt kapalı**: Panelde "Allow new users to sign up" kapatıldı (`supabase/README.md` madde 3).
- **Ayar yoksa uygulama çalışır**: `supabase` değeri `null` olabilir (`src/lib/supabase.ts:19-20`).
  Motor bu durumda `disabled` kalır.
