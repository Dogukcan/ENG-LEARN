# Faz 3 öğrenme notu: ortak sayaç, Bugün, Okuma ve Dinleme ekranları

Bu fazda uygulama ilk kez gerçek bir günlük çalışma aracına dönüştü. Tek bir sayaç var. Sayfayı yenilesen
bile sayaç kaybolmuyor. Bugün ekranı o günkü dakikaları ve sıradaki bloğu gösteriyor. Okuma ekranında kitap
konumunu ayarlıyor ve kelime yakalıyorsun. Dinleme ekranında YouTube videolarını listeliyor ve toplam dinleme
süreni görüyorsun.

## Kullanılan teknolojiler ve bu projedeki rolleri

- **TypeScript**: Kodun yazıldığı dil. Faz 1'de "hangi dilleri kullandık" diye sormuştun. Bu fazın kodunun
  hepsi TypeScript ve TSX. TSX, TypeScript içinde HTML benzeri ekran yazma biçimidir.
- **React 19 (hook'lar)**: Ekranları bileşenlerden kurar. Bu fazda yeni olan hook'lar `useState`, `useRef`,
  `useEffect`, `useContext` ve `useMemo`. Hook, bir bileşene hafıza veya yan etki ekleyen özel fonksiyondur.
- **React Context**: Bir değeri, aralarına parametre geçirmeden, birçok bileşene ulaştırır. Sayaç bu yolla
  bütün ekranlara dağılır.
- **localStorage**: Tarayıcının küçük bir anahtar-değer deposu. Sayfa yenilense de içindeki yazı kalır.
  Sayacın başlangıç zamanını burada saklıyoruz.
- **IndexedDB** (Faz 1'den): Dakika kayıtları, kitaplar, gelen kutusu ve videolar burada durur.
- **Zod 4**: Dışarıdan gelen verinin şeklini denetler. YouTube'un cevabını kontrol etmek için kullanıldı.
- **fetch**: Tarayıcının internetten veri çekme komutu. YouTube'a soru sormak için kullanıldı.
- **Vitest**: Saf mantık fonksiyonlarını test eder. Faz 3'te yeni dosyalar `todayLogic.test.ts`,
  `timerMath.test.ts`, `logic.test.ts` (Okuma), `wakeReload.test.ts` ve Dinleme için `logic/__tests__/`.

## Dosya haritası

Sayaç:
- `src/features/timer/TimerProvider.tsx`: Sayaç bileşeni ve `useTimer` hook'u.
- `src/features/timer/timerMath.ts`: Sayacın saf hesapları: geçen süre, kaydedilecek süre, `mm:ss` yazısı.
- `src/App.tsx:90`: `<TimerProvider>` bütün uygulamayı sarar. Bu yüzden sekme değiştirsen de sayaç sürer.

Bugün:
- `src/screens/BugunScreen.tsx`: Veriyi yükler, parçaları birleştirir.
- `src/features/bugun/todayLogic.ts`: Kurallar: sıradaki blok, gün şeridi geometrisi, son 7 gün.
- `src/features/bugun/HeroCard.tsx`, `DayStrip.tsx`, `SonraList.tsx`: Sadece görünüm.

Okuma:
- `src/screens/OkumaScreen.tsx`: Veriyi yükler.
- `src/features/okuma/BookPanel.tsx`, `Stepper.tsx`, `CapturePanel.tsx`, `CapturedToday.tsx`: Parçalar.
- `src/features/okuma/logic.ts`: Saf yardımcılar.

Dinleme:
- `src/screens/DinlemeScreen.tsx`: Veriyi yükler, listeleri ve "İzledim" akışını yönetir.
- `src/features/dinleme/AddSheet.tsx`: Link ya da dışarıda dinlenen dakika ekleme formu.
- `src/features/dinleme/logic/youtube.ts`: Link ayrıştırma ve oEmbed.
- `src/features/dinleme/logic/listening.ts` ve `screen.ts`: Süre, hız ve tahmin hesapları.

Gün değişimi:
- `src/features/time/useReloadOnWake.ts` ve `wakeReload.ts`: Ekranı yeniden yükleten tetikleyiciler.

## Veri nereden gelir, nereye gider

Sayaç yolu: Başlat tuşu, `localStorage` içine `{ block, startedAt }` yazar. Durdur tuşu, geçen süreyi
hesaplar ve `repository.activity.add` ile IndexedDB'ye bir "etkinlik kaydı" yazar. Kayıt yazılınca
`useRepoData` (Faz 2'den) ekranı kendiliğinden yeniden yükler. Bugün ekranındaki rakamlar bu yüzden kendi kendine güncellenir.

Bugün ekranı yolu: `BugunScreen.tsx:48` civarındaki tek yükleme, ayarları, tekrar kuyruğunu, kitapları,
son 7 günün dakikalarını, video listesini ve öğrenilen kelimeleri birlikte okur. Ekran bunları
`todayLogic.ts` fonksiyonlarına verir, sonucu üç görünüm bileşenine aktarır.

Okuma yolu: Kitap konumu `repository.books.setPosition` ile (`BookPanel.tsx:58`), aktif kitap
`repository.settings.update` ile (`BookPanel.tsx:72`), yakalanan kelime `repository.inbox.add` ile
(`CapturePanel.tsx:34`) yazılır.

Dinleme yolu: Link yapıştırılır, `parseYouTubeId` kimliği çıkarır, `fetchOEmbed` YouTube'dan başlığı alır,
`repository.videos.add` videoyu kaydeder (`AddSheet.tsx:129`). "İzledim" tuşu `markWatched` çağırır
(`DinlemeScreen.tsx:68`); bu, videonun uzunluğu kadar dakikayı Dinleme etkinliği olarak yazar.

## Yeni kavramlar

### Yenilemeden sağ çıkan sayaç
Sayaç saniyeleri saymaz. Sadece başlangıç zamanını saklar. Geçen süre her zaman "şimdi eksi başlangıç"
olarak hesaplanır: `elapsedSecondsSince` (`src/features/timer/timerMath.ts:19`).

Neden sayaçla saymıyoruz? Arka plandaki sekmelerde tarayıcı zamanlayıcıları yavaşlatır. Sayfa yenilenince de
bellekteki sayı kaybolur. Başlangıç zamanı ise ikisinden de etkilenmez.

Başlangıç zamanı `localStorage` içinde `eng-learn:running-timer` anahtarında durur
(`TimerProvider.tsx:16`). Okuma ve yazma fonksiyonları `try/catch` içinde (`TimerProvider.tsx:32` ve `:40`).
Çünkü gizli sekmede ya da site verisi engelliyken `localStorage` hata verebilir. Hata olursa sayaç yine çalışır,
sadece yenilemeden sağ çıkmaz.

Açılışta kayıtlı sayaç, ilk çizimden önce okunur (`TimerProvider.tsx:54`). Böylece yenilemeden sonra bir an
"çalışmıyor" görünmez. Bozuk bir kayıt uygulamayı çökertmez: `parsePersistedTimer` (`timerMath.ts:62`)
anlamsız bir değer görürse `null` döndürür.

Ekrandaki saniye yenilemesi için bir `setInterval` vardır (`TimerProvider.tsx:72`). Sekme geri gelince de hemen
yenilenir (`TimerProvider.tsx:74`). Bu sadece ekranı tazeler. Asıl hesap yine başlangıç zamanından yapılır.

### Tek sayaç kuralı ve çift dokunma koruması
Aynı anda sadece bir blok çalışabilir. `start` başka bir blok çalışıyorsa önce onu durdurur ve kaydeder
(`TimerProvider.tsx:104`). `toggle` (`:115`) çalışıyorsa durdurur, çalışmıyorsa başlatır.

`currentRef` (`TimerProvider.tsx:60`) bir "ref"tir. Ref, React'in yeniden çizmediği, anında güncellenen bir
kutudur. Neden gerekli? Hızlı iki dokunuş aynı çizimin eski değerini görebilir ve aynı oturumu iki kez yazabilir.
`stop` içinde önce sayaç temizlenir, sonra kayıt yazılır (`TimerProvider.tsx:81`). İkinci `stop` çağrısı durduracak bir şey bulamaz.

Kayıt yazılamazsa sayaç geri konur (`TimerProvider.tsx:99`). Böylece dakikalar kaybolmaz.

### Etkinlik dakikaları
Her etkinlik kaydı saniye olarak saklanır. Durdururken saniye, tam dakikaya yuvarlanır ve en az 1 dakika
yazılır (`secondsToRecord`, `timerMath.ts:43`). 0 saniye çalıştıysa hiçbir şey yazılmaz.
Üst sınır 180 dakikadır (`MAX_TIMER_SECONDS`, `timerMath.ts:29`). Gece boyunca açık unutulan sayaç 600
dakika yazıp haftalık rakamları bozmasın diye bu sınır var.

Bir günün dakikaları `minutesPerBlockForDay` ile okunur (`src/data/indexeddb.ts:1097`). Önce o günün
kayıtlarının saniyeleri toplanır, sonra bir kez 60'a bölünür. Kısa oturumlar böylece tam toplanır.

Kelime tekrarı da dakika yazar. `recordReviewMinutes` (`src/features/review/recordReview.ts:9`) oturum
bitince Kelime dakikasını kaydeder. Bunu yapmasaydı Bugün, tekrarı yaptıktan sonra bile Kelime'yi önermeye
devam ederdi. Tekrar süresinde sayfa arka plandayken geçen zaman sayılmaz (`reviewSessionMinutes`,
`src/features/review/reviewMinutes.ts:10`).

Canlı dakika: Çalışan sayacın dakikası henüz kayıtlı değildir. `BugunScreen.tsx:85` bunu çizim sırasında
kayıtlı dakikaya ekler. Ekstra yazma gerekmez. Gösterim `Math.round` ile tam dakikaya yuvarlanır
(`displayMinutes`), böylece sayaç durunca rakam geri sıçramaz.

### Bugün: sıradaki blok kuralı
Kural `pickNextBlock` içinde (`src/features/bugun/todayLogic.ts:46`). Üç adım:
1. Vadesi gelmiş kart varsa ve Kelime planı dolmadıysa Kelime gelir. Bekleyen kartlar değerini kaybeder.
2. Aksi halde sırayla ilk bloğa bakılır: yapılan dakika, planın altındaysa o blok gelir.
3. Her şey bittiyse yine Kelime gelir. Böylece büyük kart hiçbir zaman boş kalmaz.

Gri satır (`findingLine`, `todayLogic.ts:57`) buna göre "Minimum tamam. Sırada Kelime var." ya da
"Minimum için N dk kaldı. Sırada ... var." der.

Kelime büyük kartta "Tekrara başla" der ve tekrar oturumunu açar (`HeroCard.tsx:32`). Diğer bloklar
sayacı açıp kapatır (`BugunScreen.tsx:149`). Tekrar açılırken çalışan sayaç önce durdurulur
(`BugunScreen.tsx:143`), çünkü iki sayaç aynı anda çalışmamalı.

### Bugün: gün şeridinin geometrisi
Şerit 12 piksel yüksekliğinde bir çubuktur (`DayStrip.tsx:40`, `h-3`). Dört parçadan oluşur: Okuma, Kelime,
Dinleme, Konuşma. Her parçanın genişliği plan dakikasıyla orantılıdır. Yani 35 dakikalık plan, 10 dakikalık
plandan 3,5 kat geniştir. Bunu CSS'teki `flex` değeri yapar.

Her parçanın içi, yapılan dakika kadar renkle dolar. Yüzde 0 ile 100 arasına sıkıştırılır ve bir ondalık basamağa
yuvarlanır (`computeStrip`, `todayLogic.ts:113`).

Parçalar arasında 2 piksellik boşluk var (`STRIP_GAP_PX`, `todayLogic.ts:88`). Dört parça arasında 3 boşluk
vardır, toplam 6 piksel. Bu boşluklar yüzünden günlük minimumu gösteren küçük çentik yanlış yere düşebilirdi.
Çözüm: çentiğin konumu "toplam genişlik eksi boşluklar" üzerinden oranlanır, sonra kendinden önce biten parça
sayısı kadar boşluk eklenir. CSS tarafında bu formül `DayStrip.tsx:28`'dedir. Hangi parçanın minimum dakikayı
içerdiğini `todayLogic.ts:134` civarındaki döngü bulur. Minimum tam bir sınıra denk gelirse, çentik önceki
parçanın sonunda kalır.

Şeridin altındaki sağ yazı "N dk kaldı", plana değil günlük hedefe göredir: hedef eksi yapılan toplam
(`BugunScreen.tsx:188`).

### Bugün: son 7 gün
`lastLocalDays` (`todayLogic.ts:156`) son 7 yerel günü üretir. Gün hesabı `new Date(yıl, ay, gün - n)` ile
yapılır, 24 saat çıkarılmaz. Böylece ay sonları ve saat değişimleri bozulmaz. Bir gün, toplamı günlük minimuma
eşit ya da büyükse "çalışılmış" sayılır (`countWorkedDays`, `todayLogic.ts:166`).

### Okuma: kitap, steppers, kelime yakalama
**Kitaplar.** İki kitap tohum olarak gelir: RW1 ve RW2. Sabit kimlikleri vardır (`indexeddb.ts:249`). İki cihaz
aynı hesapla girince aynı satırı yazar ve çoğalma olmaz. Üstteki RW1 / RW2 anahtarı `settings.activeBookId` değerini
değiştirir (`BookPanel.tsx:72`).

**Stepper.** Artı ve eksi düğmeleriyle sayfa ya da ünite değiştiren denetimdir. Düğmeler 44 piksel, çünkü
parmakla basılan hedef en az bu kadar olmalı (`Stepper.tsx:10`). Değer 1'in altına inmez (`stepValue`,
`src/features/okuma/logic.ts:11`).

Hızlı basışta adım kaybolmasın diye `BookPanel.tsx:38` ve `:39` iki ref kullanır. `latest` son konumu hemen
tutar. `chain` yazmaları sıraya dizer: eski bir yazma, yeni bir yazmadan sonra bitemez. Bunu `step`
fonksiyonu yapar (`BookPanel.tsx:51`).

**Okuma sayacı.** "Okumaya başla" düğmesi ortak sayacı kullanır (`BookPanel.tsx:24`). Kayıt yazılamazsa
sayaç çalışmaya devam eder ve ekranda bunu söyleyen bir uyarı çıkar.

**Kelime yakalama.** Kaynak her zaman aktif kitap ve onun şu anki sayfasıdır, sen yazmazsın
(`CapturePanel.tsx:34` civarı). Hatalar `CAPTURE_ERROR_TEXT` içinde (`logic.ts:38`): boş kelime, gelen kutusunda
zaten var, zaten öğreniyorsun. Kaydedince form temizlenir ve odak kelime alanında kalır
(`CapturePanel.tsx:45`), çünkü kelimeler genelde arka arkaya gelir. `savingRef` (`CapturePanel.tsx:16`)
çift gönderimi engeller.

"Bugün yakalananlar" listesi (`capturedToday`, `logic.ts:62`) yerel günün sınırlarını kullanır. Bu yüzden
gece 01:30'da yakalanan kelime o güne yazılır.

### Dinleme: YouTube link ayrıştırma
İnsanlar linki çok farklı biçimlerde yapıştırır: `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`,
telefondaki `m.youtube.com`. `parseYouTubeId` (`src/features/dinleme/logic/youtube.ts:32`) hepsinden 11
karakterlik video kimliğini çıkarır. Şema yazılmamışsa kendisi ekler (`youtube.ts:37`), çünkü `URL` nesnesi
şema ister.

Güvenlik tarafı: Sadece bilinen YouTube adresleri kabul edilir (`youtube.ts:12`). Başka bir site, YouTube
gibi davranamaz. Kimlik 11 karakterlik izinli alfabeye uymak zorundadır.

### Dinleme: oEmbed
oEmbed, bir sitenin "bu linkin başlığı, kanalı ve resmi nedir" sorusuna açık cevap veren standart bir
adresidir. API anahtarı gerekmez. Bu yüzden saklanacak bir sır yoktur.

`fetchOEmbed` (`youtube.ts:100`) önce kimliği çıkarır. Link geçersizse internete hiç çıkmaz. Cevabı Zod ile
denetler (`youtube.ts:78`): başlık ve kanal yazı olmak zorundadır. Resim adresi sadece `https://i.ytimg.com`
ile başlıyorsa kabul edilir; değilse yok sayılır ve küçük resim video kimliğinden üretilir. Hata üç türdür
(`youtube.ts:92`): `network` (bağlantı yok, sonra denenebilir), `not-found` (video gizli ya da silinmiş) ve
`invalid` (beklenmeyen şekil). Fonksiyon asla hata fırlatmaz, her zaman bir sonuç nesnesi döndürür.

Form tarafında (`AddSheet.tsx:78`) arama, kimlik değişince başlar. Sonuç gelmeden yeni bir link yapıştırılırsa
eski cevap atılır. Sen başlığı elle değiştirdiysen geç gelen cevap onu ezmez (`AddSheet.tsx:65`,
`titleTouched`). oEmbed başarısız olursa "Başlığı kendin yaz" denir. Süreyi (dakika) YouTube vermez, onu sen yazarsın.

### Dinleme: videos deposu
Videolar IndexedDB'de `videos` deposundadır. Aynı video iki kez eklenemesin diye `by-youtubeKey` indeksi
`unique` tanımlıdır (`indexeddb.ts:573`). `add` önce bu indekse bakar ve varsa `duplicate` döndürür
(`indexeddb.ts:1136`). Silinmiş videoların anahtarı kaldırıldığı için aynı video tekrar eklenebilir.

"İzledim" (`markWatched`, `indexeddb.ts:1162`) tek bir transaction içinde iki şey yapar: videoyu
"izlendi" yapar ve videonun süresi kadar Dinleme etkinliği yazar. Biri olmadan diğeri olmaz. "Geri al"
(`undoWatched`, `indexeddb.ts:1198`) aynı etkinliği siler.

Dışarıda dinlediğin dakikalar (podcast, konuşma) aynı şekilde Dinleme etkinliğine yazılır, kaynağı
`manual` olur (`AddSheet.tsx:262`).

### Dinleme: toplam saat ve tarih tahmini
Toplam dinleme, bütün Dinleme etkinliklerinin saniyelerini toplayıp bir kez aşağı yuvarlar
(`totalListeningMinutes`, `indexeddb.ts:1316`). Hedef 50 saattir (`LISTENING_GOAL_HOURS`,
`src/features/dinleme/logic/listening.ts:14`). Hedef sabittir, ayar olarak değiştirilemez.

Hız, son 14 günün toplamının 14'e bölünmesidir (`PACE_WINDOW_DAYS`, `listening.ts:17`; ekranda
`paceFromDayMinutes`, `screen.ts:63`). Çalışmadığın günler de sayılır. Aksi halde tahmin fazla iyimser olurdu.

Tahmin (`projectGoalDate`, `listening.ts:75`): kalan dakika, hıza bölünüp yukarı yuvarlanır ve bugüne eklenir.
Hız 0 ise tarih hesaplanamaz. Hedefe ulaşıldıysa bugün döner. Ekran bu üç durumu `forecastText` ile
(`screen.ts:81`) "tarih", "Hedefe ulaştın" ya da "Hesaplanamadı" olarak gösterir.

### Gece yarısını geçen yenileme
Ekran "bugün" ve "vadesi gelen kart" bilgisini yüklenirken hesaplar. iPhone'da uygulama gece boyunca
bellekte kalabilir. Yenileme olmazsa sabahları dünün rakamlarını görürdün. Bu yüzden `useReloadOnWake`
(`src/features/time/useReloadOnWake.ts:8`) iki tetikleyici kurar: sayfa görünür olunca yenile, ve sayfa
açıkken her dakika yenile (`WAKE_RELOAD_INTERVAL_MS = 60_000`, `src/features/time/wakeReload.ts:9`).
Gizli sekmede yenilenmez (`wakeReload.ts:24` içindeki `startWakeReload`). Üç ekran da bunu çağırır:
`BugunScreen.tsx:64`, `OkumaScreen.tsx:33` ve `DinlemeScreen.tsx:58`.

Yerel gün hesabı için `src/data/localDay.ts:23` (`toLocalDay`) ve `:33` (`localDayRange`) kullanılır.
Bunlar Faz 1'de anlatılan yerel gün yardımcılarıdır.
