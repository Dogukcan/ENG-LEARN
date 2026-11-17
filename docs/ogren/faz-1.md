# Faz 1 öğrenme notu: iskelet, tasarım tokenları ve yerel veri katmanı

Bu fazda uygulamanın üzerine kurulacağı zemini yaptık. Ekranlarda henüz gerçek içerik yok. Ama artık
çalışan bir uygulama, D taslağından gelen renk sistemi, iPhone tarzı alt menü ve testli bir veri katmanı var.

## Kullanılan teknolojiler ve bu projedeki rolleri

- **Vite 8**: Geliştirme sunucusu ve derleyici. `npm run dev` ile açılır. Bir dosyayı kaydettiğin anda
  tarayıcı sadece değişen modülü yeniler. `npm run build` ise `dist/` klasörüne yayına hazır dosyaları üretir.
  Next.js yerine bunu seçtik, çünkü bu uygulamanın bir sunucusu yok; tamamen tarayıcıda çalışan bir PWA.
- **React 19**: Ekranları bileşenlerden kurar. Bir bileşen, veriyi alıp ekrana ne çizileceğini söyleyen bir
  fonksiyondur. Veri (state) değişince React ekranın sadece değişen kısmını yeniden çizer.
- **TypeScript 7**: JavaScript'e tip ekler. Örneğin bir kelime kaydının `source` alanını unutursan kod daha
  çalışmadan hata verir. `npm run build` önce `tsc -b` ile tipleri kontrol eder, sonra derler.
- **Tailwind CSS 4**: Stil sınıfları (`bg-ground`, `text-muted`, `rounded-card`) üretir. Renkleri doğrudan
  Tailwind'e yazmadık; önce CSS değişkeni olarak tanımladık, Tailwind sadece onlara isim verdi (aşağıda).
- **idb 8**: Tarayıcının içindeki veritabanı IndexedDB'nin zor API'sini `async/await` ile kullanılabilir yapan
  küçük bir kütüphane.
- **Vitest 5 + fake-indexeddb**: Testleri çalıştırır. Testler gerçek tarayıcı yerine Node içinde koşar;
  `fake-indexeddb` orada sahte ama tam çalışan bir IndexedDB sağlar.
- **oxlint**: Kodda yaygın hataları ve kötü alışkanlıkları bulan hızlı bir denetleyici (`npm run lint`).

## Dosya haritası

- `index.html`: Tek HTML sayfası. Türkçe dil etiketi, `viewport-fit=cover` ve Manrope yazı tipi burada.
- `src/main.tsx`: React'i sayfaya bağlayan giriş noktası.
- `src/App.tsx`: Uygulama kabuğu. Hangi sekmenin açık olduğunu tutar, adres çubuğundaki `#/kelime` gibi
  parçayla eşitler ve doğru ekranı gösterir.
- `src/components/TabBar.tsx` ve `src/components/icons.tsx`: Alt menü ve dolu/çizgili ikonlar.
- `src/screens/*.tsx`: Beş ekranın şimdilik boş hali.
- `src/styles/tokens.css`: Bütün renkler, açık ve koyu tema için. Tasarımın tek kaynağı.
- `src/index.css`: Tailwind'i yükler ve tokenlara Tailwind isimleri verir.
- `src/data/types.ts`: Verinin şekli: kitap, gelen kutusu kaydı, kelime, süre kaydı, ayarlar.
- `src/data/repository.ts`: `Repository` arayüzü. Ekranların veriye açılan tek kapısı.
- `src/data/indexeddb.ts`: Bu arayüzün IndexedDB ile yazılmış hali.
- `src/data/localDay.ts`: "Bugün" hesabını cihazın saat dilimine göre yapan küçük yardımcı.
- `src/data/index.ts`: Hepsini dışa açar ve uygulamanın tek depo nesnesini oluşturur.
- `src/data/__tests__/`: 17 test.

Veri akışı (Faz 2'den itibaren): ekran → `repository` (`src/data/index.ts:24`) → `indexeddb.ts` → tarayıcının
IndexedDB'si. Faz 4'te `indexeddb.ts` yerine bir Supabase dosyası gelecek; ekranlar değişmeyecek.

## Yeni kavramlar

### Tasarım tokenları ve `@theme inline`
Renkler `src/styles/tokens.css` içinde CSS değişkeni olarak duruyor, örneğin `--ground: #e2f3f1`.
Koyu temada aynı değişkene başka değer veriliyor. `src/index.css:14` satırındaki `@theme inline` bloğu,
Tailwind'e "`bg-ground` sınıfı `var(--ground)` olsun" der. Böylece tema değişince hiçbir bileşen
değişmez; sadece değişkenin değeri değişir. Bir rengi düzeltmek istersen tek yeri, `tokens.css` dosyasını
değiştirirsin.

### `100dvh` ve güvenli alan
`src/App.tsx:57` civarındaki yorum bunu anlatıyor. iPhone Safari'de `100vh`, adres çubuğu gizliyken olan
yüksekliği verir; çubuk görünürken alt menü ekranın dışına taşar. `100dvh` (dynamic viewport height) o an
görünen yüksekliği verir. Alt menüdeki `env(safe-area-inset-bottom)` ise iPhone'un alttaki ana ekran
çizgisinin yüksekliğidir (`src/components/TabBar.tsx:56`). Menü bu kadar yukarıda durur, çizginin altına
girmez. Bu değerin sıfırdan farklı olması için `index.html`'deki `viewport-fit=cover` gerekir.

### React state ve adres çubuğu (hash routing)
Açık sekme bir React state'i. Sekmeye dokununca hem state hem adres (`#/okuma`) değişir.
`src/App.tsx:37-43` satırları `hashchange` olayını dinler: tarayıcının geri tuşuna basınca adres
değişir, React de sekmeyi ona göre değiştirir. Sayfayı yenileyince açık sekme adresten okunur.

### Repository (depo) deseni
`src/data/repository.ts:89` satırındaki `Repository` arayüzü sadece "ne yapılabilir"i söyler: kelime ekle,
gelen kutusunu listele, süre kaydet. "Nasıl" kısmı `src/data/indexeddb.ts:120`'deki
`createIndexedDbRepository` fonksiyonunda. Ekranlar sadece arayüzü bilir. Bu sayede depolama yeri
değişse de ekran kodu aynı kalır, testler de gerçek tarayıcı olmadan yazılabilir.

### IndexedDB: nesne depoları, indeksler, transaction
IndexedDB tarayıcının içindeki veritabanıdır. `src/data/indexeddb.ts:125-143` satırlarında beş "nesne deposu"
(tablo gibi) açılıyor: `books`, `inbox`, `words`, `activity`, `settings`.
- **İndeks**: Bir alana göre hızlı arama sağlar. `inbox` deposundaki `by-normalized` indeksi
  (`indexeddb.ts:133`) `unique: true`; yani aynı kelime (küçük harfe çevrilmiş, boşlukları atılmış hali)
  gelen kutusuna iki kez giremez. Bu kuralı veritabanının kendisi de korur.
- **Transaction**: Birden fazla değişikliği "ya hepsi ya hiçbiri" olarak yapar. Bir kelimeyi gelen
  kutusundan çıkarıp kelime listesine eklemek iki depoyu değiştirir (`indexeddb.ts:278`). Arada bir hata
  olursa kelime kaybolmaz ya da iki yerde birden kalmaz.
- **Sürüm (version)**: Veritabanı yapısı değişince sürüm numarası artırılır ve `upgrade` fonksiyonu eski
  veriyi yeni yapıya taşır. Faz 2'de FSRS kart deposu eklenince sürüm 2 olacak.

### Yerel gün
"Bugün kaç dakika çalıştım" sorusu saat dilimine bağlıdır: UTC'de gece yarısı Türkiye'de 03:00'tür.
`src/data/localDay.ts` cihazın saatine göre günün başlangıç ve bitişini hesaplar, böylece gece 01:00'de
yapılan çalışma doğru güne yazılır.
