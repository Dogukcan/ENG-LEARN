# Faz 2 öğrenme notu: kelime gelen kutusu, FSRS tekrar sistemi ve Kelime ekranı

Bu fazda uygulama ilk kez gerçekten işe yarar hale geldi. Kelimeyi gelen kutusuna atıyorsun. Sonra "öğren" diyorsun.
Uygulama o kelimeyi doğru zamanda sana tekrar soruyor. Bu notta bunun nasıl çalıştığını anlatıyorum.

Bu faz iki adımda yapıldı. Adım A veri ve zamanlama motoruydu (`src/data/`). Adım B ekranlardı
(`src/features/kelime/` ve `src/screens/KelimeScreen.tsx`).

## Kullanılan teknolojiler ve bu projedeki rolleri

- **TypeScript ve TSX**: Bu projede yazdığımız dil TypeScript. Faz 1'de sormuştun, kısa cevap bu. JavaScript'in tipli halidir.
  `.ts` dosyalarında sadece mantık var. `.tsx` dosyalarında mantığın içine ekran parçası (HTML benzeri yazım) da giriyor.
- **ts-fsrs 6.0.0**: FSRS algoritmasını hazır veren kütüphane. "Bu kartı ne zaman tekrar göstereyim?" sorusunu hesaplar.
  Sürüm numarasını `package.json` içinde sabitledik (`^` yok). Çünkü 6. sürümün API'si 5'ten farklı.
- **FSRS**: "Free Spaced Repetition Scheduler" demek. Aralıklı tekrar algoritmasıdır. Bir kelimeyi unutmak üzereyken
  tekrar gösterir. Böylece az tekrarla çok hatırlarsın. Bu projede FSRS-7 modelini kullanıyoruz.
- **idb 8** ve **IndexedDB**: Faz 1'de anlattığımız tarayıcı veritabanı. Bu fazda yapısı dört kez büyüdü.
- **React 19**: Ekranlar. Bu fazda iki yeni şey öğrendik: kendi yazdığımız bir hook (`useRepoData`) ve ekranın üstüne açılan tam ekran pencere.
- **Vitest 5 + fake-indexeddb**: Testler. Zamanlama gibi karışık işlerde testler güvenlik ağıdır. Hata yaparsan hemen kırmızı olur.

## Dosya haritası

Motor (veri tarafı):
- `src/data/srs/scheduler.ts`: ts-fsrs'in tek kapısı. Başka hiçbir dosya `ts-fsrs` içe aktarmaz.
- `src/data/srs/prompt.ts`: Kartın önünde ne yazacağını ve cevabın doğru olup olmadığını belirleyen saf fonksiyonlar.
- `src/data/types.ts`: `Card` (satır 147) ve `ReviewLog` (satır 200) tipleri.
- `src/data/repository.ts`: `Repository` arayüzü (satır 259). `subscribe` ve `cards.*` metotlarının tanımı burada.
- `src/data/indexeddb.ts`: Hepsinin IndexedDB ile yazılmış hali. Sürüm yükseltmeleri satır 467'den başlar.
- `src/data/react.ts`: `useRepoData` hook'u.
- `src/data/__tests__/srs.test.ts`, `prompt.test.ts`, `subscribe.test.ts`: Bu fazın testleri.

Arayüz:
- `src/components/ui/`: Ortak parçalar: `Button.tsx`, `Sheet.tsx`, `LiveRegion.tsx`, `Panel.tsx`, `ProgressTrack.tsx`, `TextField.tsx`, `SegmentedControl.tsx`.
- `src/screens/KelimeScreen.tsx`: Kelime ekranı. Sadece veriyi yükler ve iki pencereyi açar.
- `src/features/kelime/InboxTriage.tsx`: Gelen kutusunu tek tek ayıklayan kart.
- `src/features/kelime/AddWordForm.tsx`: Kelime ekleme formu.
- `src/features/kelime/ReviewRow.tsx`: "n kart · tahmini x dk" satırı ve "Tekrara başla" düğmesi.
- `src/features/review/ReviewSession.tsx`: Tekrar oturumu.

## Veri nereden gelir, nereye gider

Kelimenin yolu şöyle:

1. Sen formdan kelime eklersin. `AddWordForm.tsx` `repository.inbox.add` çağırır. Kelime gelen kutusuna girer.
2. `InboxTriage.tsx` kelimeyi tek tek gösterir. "Öğren" dersen `repository.words.triage(..., "learning")` çalışır.
   Bu çağrı tek transaction içinde iki iş yapar: kelime `words` deposuna geçer ve `cards` deposuna yeni bir kart eklenir
   (`src/data/indexeddb.ts:831`).
3. Kart hemen "vadesi gelmiş" olur. `KelimeScreen.tsx` kuyruğu `getReviewQueue` ile okur ve "n kart" yazar.
4. "Tekrara başla" dersen `ReviewSession.tsx` açılır. Her cevapta `reviewCard` çalışır. Kart yeni durumunu alır
   ve bir `ReviewLog` kaydı yazılır. İkisi aynı transaction içindedir (`src/data/indexeddb.ts:945`).
5. Her yazma işleminden sonra depo dinleyicilere haber verir. Ekranlar veriyi yeniden yükler.

Kısaca: ekran → `repository` → `indexeddb.ts` → IndexedDB. Ekran sonra `subscribe` ile "veri değişti" haberi alır.

## Yeni kavramlar

### FSRS: stability, difficulty, due
Her kelimenin bir kartı var. Kart üç sayı ile hafızanı anlatır (`src/data/types.ts:147`).
- **stability** (kararlılık): Hafızanın kaç gün dayandığı. Tam tanımı: hatırlama şansının %100'den %90'a düşmesi için geçen gün sayısı.
  Büyük sayı, kelime iyi öğrenilmiş demek.
- **difficulty** (zorluk): Bu kelimenin senin için ne kadar zor olduğu, yaklaşık 1 ile 10 arası. Zor kelimede stability daha yavaş büyür.
- **due** (vade): Kartın bir sonraki tekrar zamanı. Kodda alanın adı `dueAt`. Veritabanında ISO metni olarak durur.

FSRS-7 ayrıca `stabilityFast` tutar. Bu, bir günlük kısa süreli hafıza içindir.

Bir kartın dört durumu var (`types.ts:129`): 0 yeni, 1 öğrenme (1 dk ve 10 dk adımlar), 2 tekrar (uzun aralıklar), 3 yeniden öğrenme (unuttun, kısa adımlar yine).

Ayarlar `src/data/srs/scheduler.ts:23-37` içinde. En önemlisi `desiredRetention: 0.9`. Yani "kelimeyi gösterdiğimde %90 hatırla" hedefi.
Hedefi yükseltirsen daha çok tekrar gerekir.

### İki düğme
Ekranda sadece iki not düğmesi var: "Unuttum" (Again) ve "Hatırladım" (Good). `gradeCardWith` bunu ts-fsrs'in
derecelendirmesine çevirir (`scheduler.ts:136`). ts-fsrs dört not bilir. Biz ikisini kullanıyoruz, çünkü karar vermesi kolay.

### Lapse ve leech
- **Lapse** (unutma sayısı): Uzun süreli hafızadaki bir kelimeyi unutmaktır. Sadece kart "tekrar" durumundayken
  "Unuttum" dersen sayılır (`scheduler.ts:154`). Öğrenme adımlarında yanılmak lapse değildir. Bu kuralı Anki de kullanır.
  Böylece normal çabalama seni suçlu kelime yapmaz.
- **Leech** (sülük): 5 lapse'e ulaşan kelime. Zaman yer, başka yöntem gerekir. Eşik `scheduler.ts:11` içinde `LEECH_THRESHOLD`.
  Kart `leech: true` olur ve `listLeeches` onu listeler (`indexeddb.ts:993`).

### Tekrar kuyruğu
`getReviewQueue` (`src/data/indexeddb.ts:907`) üç şey yapar.
1. Vadesi gelmiş kartları bulur. `by-due` indeksi ile "vade bugünden önce mi" diye aralık sorgusu yapar.
2. Kartları hatırlama olasılığına göre dizer. En çok unutulmak üzere olan kart en başa gelir.
   Sadece tarihe bakmak yetmez. Bir gün gecikmiş ama sağlam kart ile bir gün gecikmiş kırılgan kart aynı değildir.
3. Oturumu süreye sığdırır. Varsayılan 15 dakika ve kart başına 20 saniye. Yani en fazla 45 kart.

Hatırlama olasılığı FSRS'in unutma eğrisinden gelir (`scheduler.ts:199`). Eğri tekrardan hemen sonra 1'dir ve günler geçtikçe düşer.

### Yeni kart sınırı
Günde en fazla 10 yeni kart açılır. Sınır dolunca "Öğren" `{ ok: false, reason: "new-card-limit" }` döner ve hiçbir şey değişmez
(`indexeddb.ts:886`). Gün, cihazın saat dilimine göre hesaplanır. Bu Faz 1'deki "yerel gün" fikridir.

### Tekrar yakalama (`previousStatus`)
"Biliyorum" ya da "Yok say" dediğin kelimeyi ileride yine gelen kutusuna ekleyebilirsin. Bu serbest. Kaydın üstüne `previousStatus` yazılır
(`indexeddb.ts:655`). Ekranda "Daha önce: biliyorum" görürsün. Zaten öğrendiğin bir kelime reddedilir (`already-learning`, `indexeddb.ts:649`).
Ayıklarken ikinci bir `Word` açılmaz. Var olan kelime güncellenir (`indexeddb.ts:851`).

### IndexedDB sürümleri v2 - v5
Veritabanı yapısı değişince sürüm numarası artar. `upgrade` fonksiyonu eski cihazdaki veriyi taşır (`indexeddb.ts:467`). Sürüm sabiti `indexeddb.ts:102`.
- **v2**: `cards` ve `reviewLogs` depoları eklendi. `by-wordId` indeksi `unique`. Yani bir kelimeye tek kart (`indexeddb.ts:493`).
- **v3**: Kelime anahtarları (`normalized`) yeni kuralla yeniden hesaplandı. Eğri ve düz kesme işareti aynı sayılsın diye (`indexeddb.ts:505`).
- **v4**: Senkron için her kayda `updatedAt` ve her depoya `by-updatedAt` indeksi geldi. Yeni depolar: videolar, konuşma kayıtları (`indexeddb.ts:512`).
- **v5**: İki hazır kitabın sabit kimlikleri oldu, eski rastgele kimlikli kopyalar birleştirildi (`indexeddb.ts:572`).

Kural: `oldVersion < 2` gibi koşullar sırayla çalışır. Yeni cihaz 0'dan 5'e, eski cihaz kaldığı yerden 5'e gider.
Upgrade içinde sadece IndexedDB isteklerini `await` et. Başka şey beklersen tarayıcı transaction'ı erken kapatır.
Bu yüzden zamanlayıcı transaction açılmadan önce beklenir (`indexeddb.ts:834`).

### Cloze (boşluk doldurma) ve cevap kontrolü
`buildPrompt` (`src/data/srs/prompt.ts:80`) karta ne yazılacağına karar verir.
- Cümle varsa: cümledeki kelime `____` olur. Bu "cloze". `walk` kelimesi `walked`, `walking`, `walks` biçimleriyle de boşaltılır.
- Cümle yok, Türkçe anlam var: "Türkçesi: ..." yazar, sen İngilizce kelimeyi yazarsın.
- İkisi de yok: kelime görünür. Kendin "biliyor muyum" diye karar verirsin.

`checkAnswer` (`prompt.ts:119`) büyük küçük harfi, kenardaki boşluğu ve noktalamayı yok sayar. `alternatives` listesindeki yazımları
(harbor / harbour) ve cümlede boşaltılan çekimli biçimi de kabul eder.

### Depo aboneliği: `subscribe` ve `useRepoData`
Sorun şu: formdan kelime eklenince başka bir ekrandaki sayı da değişmeli. Çözüm iki parça.
- `repository.subscribe(listener)` (`src/data/repository.ts:264`): "bir yazma bitti, haber ver" kaydı. Haber, transaction bittikten sonra gider.
  `notifying` sarmalayıcısı bunu sağlar (`indexeddb.ts:361`). Hiçbir şey değiştirmeyen yazma (`ok: false`) haber vermez.
- `useRepoData(load, deps)` (`src/data/react.ts:12`): Bir React hook'u. Açılışta, `deps` değişince ve her yazmadan sonra `load` çalıştırır.
  Yavaş eski cevap yeni cevabın üstüne yazmasın diye `cancelled` bayrağı kullanır (`react.ts:37`).

Örnek kullanım: `src/screens/KelimeScreen.tsx:24` ve `src/App.tsx:24`. Sekmedeki rozet böyle canlı kalır.

### Ortak arayüz parçaları
- **Button** (`src/components/ui/Button.tsx:55`): Dört görünüm: `primary-block`, `neutral`, `text`, `icon`. Boyutlar hep 44 ya da 56 piksel.
- **aria-disabled**: Düğmeyi `disabled` ile kapatmadık. Gerçek `disabled` düğmeye odak gitmez, ekran okuyucu kullanıcı nedenini duyamaz.
  `aria-disabled` düğme odaklanabilir kalır. Tıklamayı kodla engelleriz (`Button.tsx:89-91`).
- **DisabledReason** (`Button.tsx:109`): Düğmenin neden kapalı olduğunu gösteren görünür yazı. Düğmeye `aria-describedby` ile bağlanır.
  Örnek: `InboxTriage.tsx:217` ve `InboxTriage.tsx:228-229`.
- **Sheet** (`src/components/ui/Sheet.tsx:45`): Yerel `<dialog>` üstüne kurulu pencere. Tarayıcı arkadaki sayfayı kilitler. Escape tuşu `onCancel` ile gelir.
  Çocukları sadece açıkken yerleşir, bu yüzden form her açılışta boş başlar. Kapanınca odak açan düğmeye döner.
- **LiveRegion** (`src/components/ui/LiveRegion.tsx:19`): Ekran okuyucuya "Eklendi: awkward" gibi mesajları sesli söyleyen alan.
  Erken yerleştirilir ve hep açık kalır. Sadece yazısı değişir.

### Kelime ekranı ve tekrar oturumu
- `KelimeScreen.tsx` veriyi tek `useRepoData` çağrısıyla yükler (satır 24-31). İki pencere açar: ekleme formu (satır 92) ve tekrar oturumu (satır 102).
- `InboxTriage.tsx` bir seferde tek kelime gösterir. İşlem sonrası odağı bir sonraki kartın "Öğren" düğmesine taşır. Limit doluysa "Biliyorum"a taşır
  (`InboxTriage.tsx:97-98`).
- `ReviewSession.tsx:34` oturumu `Sheet` içine koyar. Kuyruk açılışta bir kez yüklenir (`ReviewSession.tsx:105`). Oturum sırasında kartlar yer değiştirmez.
- Cevap kontrolü `check` içinde (`ReviewSession.tsx:195`). Not verme `grade` içinde (`ReviewSession.tsx:213`). "Son cevabı geri al" `undo` içinde (`ReviewSession.tsx:235`).
  Geri alma, son `ReviewLog` içindeki `previousCard` kopyasını geri yazar (`indexeddb.ts:969`).
