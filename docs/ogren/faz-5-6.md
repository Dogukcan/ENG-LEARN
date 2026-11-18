# Faz 5 ve 6 öğrenme notu: Konuşma köprüsü, İstatistik, PWA ve test stratejisi

Bu fazlarda uygulamaya dört şey ekledik. Birincisi Konuşma köprüsü: dış bir yapay zekayla konuşup sonucu
uygulamaya geri alıyorsun. İkincisi İstatistik ekranı: çalışmanın sayıya dönmüş hali. Üçüncüsü PWA:
uygulamayı telefonuna kurabiliyorsun. Dördüncüsü testler: hepsi gerçek tarayıcı ve gerçek sunucu olmadan sınanıyor.

## Kullanılan teknolojiler ve bu projedeki rolleri

- **Zod 4.6.7**: Gelen verinin şeklini denetleyen kütüphane. Yapay zekanın verdiği raporun doğru biçimde
  olup olmadığına Zod bakar. Şekle "şema" denir.
- **JSON**: Veriyi metin olarak yazma biçimi. Örneğin `{ "word": "borrow" }`. Yapay zeka raporunu bu biçimde verir.
- **vite-plugin-pwa 2.0.0**: Vite'a bir eklenti olarak takılır. Uygulamayı kurulabilir yapan manifest dosyasını
  ve service worker dosyasını derleme sırasında kendisi üretir.
- **Workbox**: Google'ın service worker aracı. vite-plugin-pwa onu arka planda kullanır. Hangi dosyanın
  önbelleğe alınacağını Workbox ayarları belirler.
- **Service worker**: Tarayıcının sayfadan ayrı çalıştırdığı bir arka plan betiği. Ağ isteklerinin arasına girer.
  Dosyaları saklar, internet yokken uygulamanın açılmasını sağlar.
- **Web app manifest**: Uygulamanın adını, ikonlarını ve renklerini anlatan küçük bir JSON dosyası.
  Tarayıcı "ana ekrana ekle" derken ona bakar.
- **Vitest 5**: Testleri çalıştıran araç (`npm test`). Faz 1'den beri var.
- **fake-indexeddb 6.2.8**: Node içinde çalışan sahte ama tam bir IndexedDB. Veri katmanı testlerinin hepsi bunu kullanır.
- **Supabase JS 2.119.1**: Bulut veritabanıyla konuşan kütüphane. Testlerde gerçeğini kullanmıyoruz;
  yerine elle yazılmış sahte bir istemci koyuyoruz.

Bu fazlarda yeni dil eklemedik. Hepsi TypeScript. Tek istisna `vite.config.ts` içindeki ayarlar; o da TypeScript.

## Dosya haritası

Konuşma köprüsü (`src/features/konusma/`):

- `logic/scenarios.ts`: 4 konuşma senaryosu. Her birinin 3 görevi ve bir bitiş koşulu var (`scenarios.ts:12`).
- `logic/errorCategories.ts`: 7 hata kategorisinin kimliği ve Türkçe etiketi (`errorCategories.ts:3` ve `:15`).
- `logic/buildPrompt.ts`: Yapay zekaya yapıştıracağın İngilizce komutu üretir (`buildPrompt.ts:28`).
- `logic/reportSchema.ts`: Raporun Zod şeması (`reportSchema.ts:67`) ve metni okuyan `parseReport` (`:113`).
- `logic/session.ts`: Küçük saf yardımcılar: hedef kelime seçimi (`session.ts:49`), hata çubukları (`:90`).
- `logic/sessionState.ts`: Sayfa yenilenince adımı ve yapıştırılan metni hatırlar.
- `PrepareStep.tsx`, `TimerStep.tsx`, `ReportStep.tsx`: Üç adımın ekranları.
- `src/data/indexeddb.ts`: `speaking.saveReport` burada (`indexeddb.ts:1166`).

İstatistik:

- `src/features/istatistik/statsLogic.ts`: Ekranın sayıları nasıl göstereceğini hesaplayan saf fonksiyonlar.
- `src/screens/IstatistikScreen.tsx`: Ekranın kendisi.
- `src/data/indexeddb.ts`: `stats` sorguları (`indexeddb.ts:1232` satırında başlar, aşağıda).
- `src/data/seed/ngsl.ts` ve `src/data/seed/ngsl-1.2.json`: Sıklık listesi ve sıra bulucu.
- `docs/lisanslar.md`: Listenin kaynağı ve lisansı.

PWA:

- `vite.config.ts`: Manifest ve Workbox ayarları.
- `index.html`: iPhone için ek etiketler (`index.html:20-24`).
- `public/`: Beş görsel dosya: `icon.svg`, `pwa-192x192.png`, `pwa-512x512.png`, `pwa-maskable-512x512.png`, `apple-touch-icon.png`.
- `src/pwa/registerSW.ts`: Service worker'ı kaydeder, "güncelleme var" bilgisini tutar.
- `src/pwa/PwaUpdateBanner.tsx`: "Yeni sürüm var." şeridi.

Testler: `src/data/__tests__/speaking.test.ts`, `stats.test.ts`, `src/features/konusma/logic/konusma.test.ts`,
`src/data/seed/__tests__/ngsl.test.ts`, `src/features/sync/engine.test.ts`, `vitest.config.ts`.

## Veri nereden gelir, nereye gider

Konuşma köprüsü, adım adım:

1. `PrepareStep.tsx:28` senaryoyu, hedef kelimeleri ve hata kategorilerini `buildPrompt` fonksiyonuna verir.
2. Sen metni kopyalayıp ChatGPT ya da Gemini'ye yapıştırırsın ve sesli konuşursun.
3. Konuşma bitince yapay zeka sadece bir JSON raporu yazar. Sen onu `ReportStep.tsx` içindeki kutuya yapıştırırsın.
4. "İşle" düğmesi `parseReport(text)` çağırır (`ReportStep.tsx:41`). Metin bozuksa kırmızı bir Türkçe hata çıkar. Hiçbir şey kaydedilmez.
5. Metin geçerliyse `repository.speaking.saveReport` çağrılır (`ReportStep.tsx:50`).
6. `saveReport` tek bir transaction içinde üç şey yazar: oturum kaydı, hatalar, yeni kelimeler (`indexeddb.ts:1166`).
7. Yeni kelimeler gelen kutusuna `source: { kind: "konusma" }` ile girer. Orada normal bir kelime gibi ayıklanır.

İstatistik: `src/screens/IstatistikScreen.tsx:83` içindeki `useRepoData` sekiz sorguyu birden çalıştırır
(`repo.stats.*`). Sorgular IndexedDB'den okur. `statsLogic.ts` ham sayıları ekranda gösterilecek satırlara çevirir.

PWA: `npm run build` → `vite-plugin-pwa` → `dist/manifest.webmanifest` ve `dist/sw.js`. Tarayıcı sayfayı açınca
`src/main.tsx:14` service worker'ı kaydeder. Yeni sürüm gelince `registerSW.ts` içindeki bir bayrak açılır,
`PwaUpdateBanner.tsx` o bayrağı okuyup şeridi gösterir.

## Yeni kavramlar

### Köprü fikri: neden API yok?
Uygulama yapay zekayı kendisi çağırmıyor. Sen komutu elle kopyalıyorsun, raporu elle yapıştırıyorsun.
Bu bilinçli bir seçim. Böylece uygulamada gizli bir API anahtarı yok ve sesli konuşma için hazır
uygulamaları kullanabiliyorsun. Bedeli şu: yapay zeka bazen biçimi bozar. Bu yüzden rapor okuyucu sıkı çalışır.

### Prompt builder (komut kurucu)
`buildPrompt` bir metin şablonudur. İçine seviye (varsayılan `B1`), senaryo, görevler, hedef kelimeler
ve hata kategorilerini koyar (`buildPrompt.ts:36`). Kurallar da metnin içinde: her cümlede araya girme,
izlenen kategoride önce hatayı göster, doğrusunu sonra ver, her cevabı soruyla bitirme, 3 görevden sonra
kapat (`buildPrompt.ts:49-54`). Rapor biçimi komutun içine örnek olarak gömülü (`buildPrompt.ts:15`).
Yapay zeka o örneği taklit eder. Örnek ile şema aynı şekli anlatmalı; dosyadaki yorum bunu hatırlatıyor.

### Zod şeması ve `parseReport`
Şema, raporun şeklini kod olarak yazar: `errors`, `betterPhrases`, `newWords` listeleri ve isteğe bağlı
`summary` (`reportSchema.ts:67-85`). Kategori `z.enum` ile kısıtlı (`reportSchema.ts:72`). Bilinmeyen bir
kategori sessizce başka bir kategoriye çevrilmez; reddedilir. Böylece yapay zekanın biçimi bozduğunu sen görürsün.

`parseReport` iki iş yapar:
- **Metni bulur.** Sırayla şunları dener: ham metin, ```json çitinin içi, ilk `{` ile son `}` arası
  (`reportSchema.ts:103-111`). Sohbet uygulamaları JSON'u sık sık açıklama cümlelerinin içine koyar.
- **Şekli denetler.** `safeParse` hata fırlatmaz, sonucu döndürür. İlk sorunu `errors[2].category geçersiz: ...`
  gibi bir yol ile yazar (`reportSchema.ts:92` ve `:133-143`).

Sonuç iki biçimden biridir: `{ ok: true, report }` ya da `{ ok: false, message }`. Buna "ayrık birleşim"
denir. TypeScript `ok` değerine bakmadan `report` alanını kullanmana izin vermez.

### Hataları ve yeni kelimeleri kaydetmek
`saveReport` kayıtları aynı transaction içinde yazar (Faz 1'deki transaction kavramı). Bir kelime eklenirken
sorun çıkarsa oturum ve hatalar da geri alınır. Yeni kelime boşsa, gelen kutusunda zaten bekliyorsa ya da
zaten öğreniliyorsa atlanır ve sayılır. Sonuç `wordsAdded` ve `wordsSkipped` olarak döner (`indexeddb.ts:1219`).
Aynı kelime raporda iki kez geçse bile ikincisi atlanır; çünkü birincisi transaction içinde zaten görünür.
Ham rapor da oturumla birlikte saklanır (`rawReport`, `indexeddb.ts:1177`).

Çift dokunmaya karşı da önlem var: aynı metin bir kez işlendikten sonra "İşle" kapanır (`ReportStep.tsx:55`
ve `:35`). Rapor iki kez sayılmaz.

### Sayfa yenilenirse ne olur?
iPhone uygulamayı bellekten atabilir. `sessionState.ts` adımı, senaryoyu ve yapıştırılan metni
`sessionStorage` içinde tutar. Depolama hata verebilir; bu yüzden her erişim `try/catch` içinde.

### İstatistik sorguları
Her sorgu `src/data/indexeddb.ts` içindeki `stats` nesnesinde. Başlıcaları:
- `minutesPerBlockPerDay` (`indexeddb.ts:707`): Aralıktaki her yerel gün için dört bloğun dakikası. Etkinlik yoksa sıfır döner.
  Saniyeleri önce toplar, sonra tek kez 60'a böler; kısa oturumlar kaybolmaz.
- `consistency`: Günlük asgariye ulaşılan gün sayısı, son 7 ve son 30 gün için.
- `wordCounts`: Duruma göre kelime sayısı (`learning`, `known`, `ignored`).
- `reviewSuccessRate`: Son 7 günde "good" cevapların payı. Hiç tekrar yoksa `null` döner; ekran "henüz veri yok" der.
- `leechCount`: Sürekli unutulan kart sayısı.
- `speakingErrorsWeekOverWeek` (`indexeddb.ts:1291`): Kategori başına bu hafta ve geçen hafta hata sayısı.
  İçinde `errorsPerCategory` (`indexeddb.ts:688`) iki kez çalışır.

Sorgular "yerel gün" kullanır (Faz 1'deki kavram), yani gece 01:00'deki çalışma doğru güne yazılır.
`statsLogic.ts` ise saf fonksiyonlardan oluşur: haftalık sütunlar (`:97`), ay ızgarası (`:146`), tutarlılık metni (`:159`).
Saf fonksiyon, aynı girdiye hep aynı çıktıyı verir ve dış dünyaya dokunmaz. Test etmesi kolaydır.

### NGSL bantları
NGSL (New General Service List), İngilizcenin en sık kullanılan 2.809 kelimesinin listesi. Sıklık sırasına
göre dizilidir; 1. kelime en sık olandır. `rankOf(lemma)` bir kelimenin sırasını verir, listede yoksa `null`
(`ngsl.ts:27`). Kelime önce `normalizeWord` ile temizlenir: küçük harf, boşluk, kıvrık kesme (`ngsl.ts:28`).
`walked` gibi çekimli bir biçim lemma değildir, bu yüzden `null` döner (`ngsl.test.ts:20-24`).

`knownWordsPerNgslBand` (`indexeddb.ts:1262`) sadece "known" kelimelere bakar. Sıraya göre dört banttan birine
koyar: `1-1000`, `1001-2000`, `2001-2809` ya da `listede yok` (`repository.ts:199`). Ekran bununla
"çekirdek listenin ne kadarını biliyorum" sorusunu cevaplar.

### Lisans ve atıf
Liste CC BY-SA 4.0 lisanslı. Bu lisans üç şey ister: yazarı belirt, lisansı belirt, değişikliği belirt.
`docs/lisanslar.md` bunların tam metnini veriyor. Ekran da bu metni gösteriyor
(`IstatistikScreen.tsx:324`). Biz sadece sözcükleri aldık ve JSON'a çevirdik; metin bunu söylüyor.
"ShareAlike" şartı listenin kendisi için geçerli. Uygulamayı herkese açarsan bu konuyu ayrıca gözden geçir;
`docs/lisanslar.md` de aynısını söylüyor.

### PWA nedir?
PWA (Progressive Web App), tarayıcıda çalışan ama telefona uygulama gibi kurulabilen web uygulamasıdır.
Üç parçası var: manifest, service worker ve ikonlar.

### Manifest
`vite.config.ts:21-36` manifest ayarlarını verir. Ad `ENG-LEARN`, kısa ad `ENG`, dil `tr`,
`display: 'standalone'` (adres çubuğu olmadan açılır). Başlangıç adresi `/#/bugun` (`vite.config.ts:26`).
Renkler tek yerden gelir: `GROUND` sabiti açık temanın zemin rengidir. Manifest gerçek renk ister,
CSS değişkeni olmaz; bu yüzden değer burada tekrarlandı ve yorumda söylendi.
İkonlardan biri `purpose: 'maskable'` (`vite.config.ts:34`). Android ikonu daire ya da kare gibi
farklı şekillere keser. Maskable ikonun kenarında güvenli boşluk vardır.

### Service worker ve Workbox önbelleği
Derleme sırasında vite-plugin-pwa `dist/sw.js` dosyasını üretir. İçinde "precache" listesi var:
uygulamanın JS, CSS, HTML ve görsel dosyaları (`vite.config.ts:39`). Bu dosyalar ilk ziyarette saklanır.
İnternet yokken uygulama oradan açılır.

Üç ayrıntı önemli:
- **`navigateFallback: 'index.html'`** (`vite.config.ts:41`). Uygulama hash adresi kullanır (`#/okuma`).
  Her sayfa aslında aynı `index.html` dosyasıdır.
- **Supabase asla önbelleğe alınmaz.** `runtimeCaching` listesinde Supabase yok (`vite.config.ts:61-62`
  civarındaki yorum). Eşleşen kural yoksa Workbox isteği ağa bırakır. Önbellek eski ya da başka bir
  kullanıcının verisini gösterebilirdi. Ayrıca `/rest/`, `/auth/` ve `/realtime/` yolları için
  `index.html` yedeği kapalı (`vite.config.ts:43`).
- **Google Fonts için `StaleWhileRevalidate`** (`vite.config.ts:48`). "Önce eskiyi göster, arkada yenisini indir"
  demektir. Yazı tipi nadiren değişir, bu strateji yeterli.

### `registerType: 'prompt'` ve güncelleme şeridi
İki seçenek vardı. `autoUpdate` yeni sürümü hemen devreye alırdı. Biz `prompt` seçtik (`vite.config.ts:18`).
Yeni service worker beklemeye geçer. Sen karar verene kadar eski sürüm çalışır. Sebep: tekrar
oturumunun ortasında kod değişmesin.

Akış şöyle:
1. `injectRegister: false` (`vite.config.ts:20`): Kaydı eklenti değil biz yapıyoruz.
2. `src/main.tsx:14` `registerServiceWorker()` çağırır.
3. `registerSW.ts:25-28`: yeni worker beklemeye geçince `onNeedRefresh` çalışır ve `updateAvailable` açılır.
4. `usePwaUpdateAvailable` (`registerSW.ts:32`) bu bayrağı React'e verir. `useSyncExternalStore` kullanır;
   bu, React dışındaki bir değişkeni güvenle okumanın yoludur.
5. `PwaUpdateBanner.tsx:25` `role="status"` ile "Yeni sürüm var." der. "Yenile" düğmesi `applyPwaUpdate` çağırır
   (`PwaUpdateBanner.tsx:17`). Başarısız olursa "Güncelleme başlamadı. Tekrar dene." yazar.
6. Kapat düğmesi şeridi sadece sonraki sayfa yüklemesine kadar saklar (`PwaUpdateBanner.tsx:39`).

Geliştirme sunucusunda service worker gerçek iş yapmaz; sadece `npm run build` çıktısında çalışır.

### iOS etiketleri
iOS Safari manifestin çoğunu yok sayar. Bu yüzden `index.html:20-24` aynı bilgileri etiketle söyler:
`apple-mobile-web-app-capable`, durum çubuğu stili `default`, başlık `ENG` ve 180×180 `apple-touch-icon`.
`theme-color` açık ve koyu tema için ayrı verilmiş (`index.html:14-15`).

### Test stratejisi
Hedef: gerçek tarayıcıya, gerçek ağa ve gerçek veritabanına ihtiyaç duymadan mantığı sınamak.
`vitest.config.ts` ortamı `node` yapar ve saat dilimini `Europe/Istanbul` olarak sabitler (`vitest.config.ts:8-11`).
Saat dilimi sabit olmasa, "yerel gün" testleri başka bir bilgisayarda başka sonuç verirdi.

Üç katman var:
- **Saf mantık testleri.** Veritabanı yok. Örnek: `konusma.test.ts` komut metnini ve `parseReport`'un
  bozuk JSON, eksik alan ve geçersiz kategori hallerini sınar (`konusma.test.ts:24-83`). `ngsl.test.ts` sıra bulucuyu sınar.
- **fake-indexeddb ile veri testleri.** Test dosyası `import "fake-indexeddb/auto"` ile başlar
  (`speaking.test.ts:1`). Bu satır Node'a sahte bir IndexedDB verir. Her test kendine yeni bir veritabanı adı
  açar (`speaking.test.ts:7`), böylece testler birbirinin verisini görmez. `stats.test.ts` aynı yöntemle
  tüm istatistik sorgularını sınar.
- **Sahte Supabase istemcisi.** `engine.test.ts:61` içindeki `fakeClient`, gerçek istemcinin sadece `from(...)`,
  `upsert` ve `select` gibi kullanılan kısmını taklit eder. Yapılan çağrıları listeye yazar, sunucu satırlarını
  bellekten verir ve istenirse hata döner. Aynı dosyada `fakeRepo` (`engine.test.ts:13`) sahte depodur.
  Böylece eşitleme motoru ağsız ve IndexedDB'siz sınanır.

Testlerin ortak mantığı: gerçek dünyanın yavaş ve değişken parçasını (ağ, saat, tarayıcı depolaması) sahtesiyle
değiştir, geriye kalan kodu doğrudan sına. Son kayıtlı çalıştırma 335 test geçti (commit `89e3d42`).
