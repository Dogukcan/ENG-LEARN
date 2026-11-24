# Faz 8 öğrenme notu: Bugün yol tasarımı, container query ölçeklemesi ve tema renkleri

Bu fazda Bugün ekranını baştan tasarladık. Eski kart ve liste görünümü yerine kıvrımlı bir "S" yolu kurduk.
Dört ana beceri (Okuma, Kelime, Dinleme, Konuşma) bu yol üzerinde sırayla halkalar halinde dizildi.
Bununla birlikte uygulamanın renk paletini güncelledik: karanlık temaya derin petrol, aydınlık temaya krem paneller geldi.

Bu fazın asıl dersi şu: Görsel olarak zengin ve hareketli bir arayüz yaparken mantığı arayüzden ayırmak gerekir.
Geometri ve durum kuralları saf fonksiyonlarda yaşarsa, karmaşık çizimler bile DOM olmadan hızla test edilebilir.

## Kullanılan teknolojiler ve bu projedeki rolleri

- **CSS Container Query (`cqw`)**: Bileşenin kendi genişliğine göre boyutlanmasını sağlar. Ekran genişliği
  ne olursa olsun yol, halkalar ve boşluklar oranını korur.
- **SVG Path ve LinearGradient**: Kıvrımlı yol şeridini ve tamamlanan bölümü renk geçişiyle çizer.
- **Vitest**: `pathLogic.ts` içindeki geometri, halka doluluk oranları ve konuşma balonu mantığını Node
  ortamında hızlıca test eder.
- **React ve Tailwind CSS**: `SkillPath`, `SkillNode` ve `NodeSheet` bileşenlerini bir araya getirir.

## Dosya haritası

- `src/features/bugun/pathLogic.ts`: Saf geometri ve durum mantığı. Koordinatlar, oranlar, halka durumları,
  tek konuşma balonu kuralı ve Türkçe erişilebilirlik metinleri burada hesaplanır.
- `src/features/bugun/pathLogic.test.ts`: Geometri ve durum fonksiyonlarının birim testleri.
- `src/features/bugun/SkillPath.tsx`: Yol sahnesi, SVG şerit çizgisi ve `role="list"` taşıyan sıralı liste.
- `src/features/bugun/SkillNode.tsx`: Düğüm bileşeni. Halka, dokunmatik disk, yan etiket ve konuşma balonu.
- `src/features/bugun/NodeSheet.tsx`: Bir halkaya dokunulduğunda açılan ortak `Sheet` detay paneli.
- `src/features/bugun/skillPath.css`: `cqw` birimleri, konumlandırma, dokunma animasyonları ve erişilebilirlik stilleri.
- `src/styles/tokens.css`: Güncellenen petrol ve krem tema renkleri ile kontrast tokenları.

## Neden yol tasarımı ve saf geometri

Bugün ekranı kullanıcının o günkü planını gösterir. Düz bir liste yerine kıvrımlı bir yol seçtik.
Çünkü yol tasarımı hem günün sırasını görselleştirir hem de ne kadar ilerlendiğini tek bakışta hissettirir.

Bu yolun tüm geometrisi (`PATH_WIDTH`, `PATH_HEIGHT`, `NODE_ANCHORS`, `RIBBON_PATH`) doğrudan `pathLogic.ts`
içinde saf sayılarla tanımlandı:

- Saf fonksiyonlar React ya da DOM nesnelerine bağımlı değildir.
- Halka doluluğu (`ringFraction`), günün tamamlanma payı (`coveredFraction`) ve koordinat yüzdeleri
  (`placementPercent`) doğrudan Node ortamında saniyeler içinde test edilir.
- Tarayıcıyı açmadan çizim sınırları ve taşmalar matematiksel olarak doğrulanabilir.

## Dar telefonlarda çıkan sorunlar ve çözümleri

Tasarım dar telefonlarda (örneğin 320px–360px genişlik) denendiğinde iki kritik sorun bulundu:

1. **Sabit piksel (`px`) kullanımı ve üst üste binme:**
   Yol sahnesi daraldığında sabit piksel boyutlu balonlar üstteki düğümün üzerine biniyordu.
   Çözüm olarak sahneye `container-type: inline-size` verildi ve tüm boyutlar `cqw` (container query width)
   birimine çevrildi. 358px referans genişlik alınarak `calc(değer / 358 * 100cqw)` formülüyle her parça
   sahneyle birlikte orantılı küçüldü.
2. **Yan etiketlerin harf harf kırılması (shrink-to-fit çökmesi):**
   Halkaların yanındaki etiketler `position: absolute` ile konumlandırılmıştı. Mutlak konumlu kutular
   içerik kadar daralır (shrink-to-fit). `overflow-wrap: anywhere` kuralı eklenince dar alanda tarayıcı
   kelimeleri harf harf alt satıra böldü. Çözüm olarak genişlik `width: max-content` yapıldı,
   üst sınır `max-width` ile kısıtlandı ve kural `overflow-wrap: break-word` olarak düzeltildi.

## Tek konuşma balonu ve erişilebilirlik

Yol üzerinde her an sadece tek bir konuşma balonu görünür (`bubbleBlock` kuralı):

- **Kural:** Eğer o an çalışan bir sayaç varsa balon o bloğun üzerinde durur. Çalışan sayaç yoksa sıradaki
  planlanan bloğun üzerinde durur (`running ?? next`).
- **Tek dokunuşla durdurma:** Önceden sıradaki olmayan bir blok çalışırken durdurmak için detay paneline
  gitmek gerekiyordu. Artık balon doğrudan çalışan bloğun üstüne yerleştiği için tek dokunuşla durdurulabilir.

Erişilebilirlik tarafında üç önemli tercih yapıldı:

1. **VoiceOver ve `role="list"`:** Safari ve WebKit, CSS'te `list-style: none` görünce `<ol>` etiketinin liste
   özelliğini kaldırır. Ekran okuyucuların düğümleri 4 maddelik bir liste olarak okuması için `<ol role="list">`
   kullanıldı.
2. **`aria-pressed` kaldırıldı:** Butonun üzerinde zaten dinamik olarak "Başla" ya da "Durdur" yazmaktadır.
   Metni açıkça durum bildiren bir butona ayrıca `aria-pressed` eklemek ekran okuyucuda kafa karışıklığı
   yaratır; bu yüzden sadece açıklayıcı Türkçe `aria-label` korundu.
3. **Hareketi azaltma (`prefers-reduced-motion`):** Balondaki hafif nabız (pulse) animasyonu ve basma geçişleri,
   sisteminde hareketi azaltmayı seçmiş kullanıcılar için tamamen kapatıldı.

## Renkler ve kontrast

Görsel dilde tema renkleri yenilendi:

- **Karanlık tema:** Zemin artık siyah değil, derin petrol tonudur (`#0f2a2c`). Kart yüzeyleri ise `#173b3e` rengindedir.
- **Aydınlık tema:** Paneller çiğ beyaz yerine gözü yormayan sıcak bir krem (`#fbf7ef`) tonuna çekildi.
- **Kontrast:** Tüm zemin ve metin kombinasyonları WCAG AA kontrast sınırının (en az 4.5:1) üzerinde kalacak
  şekilde test edildi.

## Yeni kavramlar

### Container Query Units (`cqw`)
Viewport (`vw`) ekranın tamamına bakar. Container Query birimi (`cqw`) ise elemanın içinde bulunduğu
konteynerin genişliğini (1cqw = konteynerin %1'i) temel alır. Böylece bir bileşen nereye koyulursa koyulsun
kendi alanı içinde kusursuz ölçeklenir.

### Shrink-to-fit genişlik
Mutlak konumlu (`position: absolute`) veya kayan (`float`) elemanlar genişlik verilmezse içeriği kadar daralır.
Dar alanda agresif kelime bölme kuralları kullanılırsa metin dikey tek harfli şeritlere dönüşebilir.

### Saf geometri (Pure Geometry)
Görsel koordinatların, yayların ve mesafelerin React bileşeninden ayrı, saf matematiksel veri ve fonksiyonlar
olarak tutulmasıdır. Bu sayede görsel mantık tarayıcı açılmadan Vitest ile test edilir.

## Kendin dene

1. `skillPath.css` dosyasında `.skill-path-stage` seçicisindeki `container-type: inline-size` satırını geçici
   olarak kaldırıp tarayıcıda genişliği daralt. Halka ve metinlerin nasıl davrandığını gözlemle.
2. `pathLogic.test.ts` dosyasını incele. Geometri ve oran testlerinin DOM olmadan nasıl çalıştığını gör.
3. `pathLogic.ts` içindeki `bubbleBlock` fonksiyonunu incele. Hem çalışan blok hem sıradaki blok varken
   balonun hangi bloğa gideceğini belirleyen tek satırlık kuralı bul.

## Kendini sına

1. Geometriyi React bileşeni yerine `pathLogic.ts` içinde tutmak teste nasıl yardımcı olur?
2. Dar telefonlarda sabit piksel (`px`) yerine neden `cqw` birimi tercih edildi?
3. `position: absolute` ile konumlanan bir etikette `overflow-wrap: anywhere` neden harf harf kırılmaya yol açtı?
4. Neden her halkanın üzerinde değil de aynı anda sadece tek bir konuşma balonu gösterilir?
5. Safari'de `list-style: none` verilmiş bir `<ol>` için neden `role="list"` eklemek gerekir?
