# Faz 10 öğrenme notu: Saatten bağımsız push sırası ve ekranlarda ortak beceri halkası

Bu fazda iki iş yapıldı. İlki görünmeyen ama önemli bir eşitleme düzeltmesi: hangi satırların sunucuya gönderileceğine artık cihaz
saati karar vermiyor. İkincisi görünen bir değişiklik: Bugün ekranındaki büyük beceri halkası Okuma, Kelime, Dinleme, Konuşma ve
İstatistik ekranlarının başına taşındı.

## Kullanılan teknolojiler ve bu projedeki rolleri

- **IndexedDB (`idb`)**: Her eşitlenen depoya `localSeq` alanı ve `by-localSeq` indeksi eklendi. Şema sürümü 6 oldu.
- **IndexedDB readwrite transaction**: Aynı depoya yazan iki readwrite transaction tarayıcı tarafından sıraya konur. Sıra numarası
  bu transaction'ın içinde okunup yazıldığı için iki sekme aynı numarayı alamaz.
- **localStorage**: Motorun push imleçleri (`pushSeq.<depo>`) burada durur. Veritabanının kimliği de (`instance`) burada saklanır.
- **React 19 ve Tailwind CSS 4**: Ortak `SkillHero` ve `SkillMiniRing` bileşenleri, dokunsal (`tactile`) düğme ve panel stili.
- **Vitest, fake-indexeddb ve iki cihazlı düzenek**: Saat geri alındığında, eski veritabanı yükseltildiğinde ve veritabanı yeniden
  oluştuğunda hiçbir satırın sunucuya gitmeden kalmadığını gösteren testler.

## Dosya haritası

- `src/data/indexeddb.ts`: Yazma yollarında `localSeq` ataması, sürüm 5'ten 6'ya geçiş, `syncMeta` deposu, `maxLocalSeqThrough`,
  `upgradeMaxLocalSeq`, `instanceId`.
- `src/data/repository.ts`: Bu yeni veri işlemlerinin arayüzü.
- `src/features/sync/engine.ts`: `pushCursor` (eski zaman imlecinden sıra imlecine geçiş), veritabanı kimliği değişince imleçleri
  sıfırlama.
- `src/data/__tests__/localSeq.test.ts`, `src/features/sync/__tests__/twoDevices.test.ts`: Yeni senaryoların testleri.
- `src/features/skill/`: `heroLogic.ts` (saf etiketler ve oranlar), `SkillHero.tsx`, `SkillMiniRing.tsx`, `skillHero.css`.
- `src/components/ui/Button.tsx`, `Panel.tsx`: İsteğe bağlı `tactile` seçeneği.
- `src/screens/*Screen.tsx` ve `src/features/<ekran>/`: Beş ekranın yeni görünümü.

## Sorun neydi: Push sırasını saat belirliyordu

Önceki sürümde motor her depo için "en son hangi zamana kadar gönderdim" bilgisini tutuyordu. Bir sonraki turda `updatedAt` değeri bu
zamandan büyük olan satırları gönderiyordu. Bu, saatin hep ileri gittiğini varsayar. Telefon saati ağdan düzeltildiğinde ya da elle geri
alındığında bu varsayım bozulur. Saat geri gittikten sonra yazılan bir satırın `updatedAt` değeri imlecin altında kalır. Motor onu
"zaten gönderildi" sanar ve satır hiç gönderilmez. Bekleyen sayısı da 0 görünür.

İlk düşünülen çözüm "monoton saat" idi: her yazma `max(şimdi, son damga + 1 ms)` alsın. Bağımsız inceleme bunun üç yerden kırıldığını
gösterdi. Her sekmenin kendi saati olur. Uzak bir cihazdan gelen ileri tarihli bir satır saati ileri iter. Yükseltme sırasındaki yazmalar
da saat hazırlanmadan önce olur. Kök neden şuydu: tek bir değer iki işi birden yapıyordu. Hem "ne zaman değişti" bilgisini tutuyordu,
hem de "hangi sırayla gönderilecek" sorusunu cevaplıyordu.

## Çözüm: İki işi ayırmak

- `updatedAt` yine gerçek saattir. Son değiştiren kazanır kuralı ve sunucu damgası aynı kaldı.
- Gönderme sırası ayrı bir sayaçtır: `localSeq`. Her yerel yazma, aynı readwrite transaction içinde depodaki en büyük `localSeq`
  değerini okur ve bir fazlasını yazar. Sunucudan gelen satırlar numaralarını değiştirmez; yeni gelen satır 0 alır, yani
  "gönderilecek" sayılmaz.
- Motor her depo için "en son hangi numaraya kadar gönderdim" bilgisini tutar. Gönderilecek satırlar `localSeq` değeri bundan büyük
  olanlardır. Saat ne yaparsa yapsın sayaç hep artar.

## Eski cihazlar: Yükseltme ve imleç geçişi

Sürüm 5'ten 6'ya geçen bir cihazda satırların numarası yoktur. Yükseltme her depodaki satırları `updatedAt` sırasıyla 1'den başlayarak
numaralar. Hiçbir satır silinmez. Burada iki tuzak çıktı ve ikisi de testle yakalandı:

1. **Her şeyi yeniden göndermek.** İmleç 0'dan başlarsa yıllardır gönderilmiş satırlar da tekrar gider. Eski bir mezar taşı başka
   cihazda yeniden canlandırılmış bir kartı silebilir. Bu yüzden ilk turda eski zaman imleci, "o zamana kadar olan en büyük numaraya"
   çevrilir.
2. **Çeviriye sonradan yazılanları katmak.** Yükseltmeden sonra ama ilk eşitlemeden önce, saat geri durumdayken yazılan bir satırın
   `updatedAt` değeri eski imlecin altındadır ve numarası en büyüktür. Çeviri onu da sayarsa imleç, aradaki bekleyen satırların
   hepsinin üstüne atlar. Düzeltme: yükseltme, verdiği en büyük numarayı `syncMeta` deposuna yazar. Çeviri sadece bu sınırın altındaki
   numaralara bakar. Bu numaralar `updatedAt` sırasıyla verildiği için indeksi yukarıdan aşağı yürüyüp ilk uygun satırda durmak yeter.

Bu ikinci hata önemli bir ders verdi: sonradan bir `min(...)` ile sınırlamak yetmez. Yanlış satırlar hesaba katıldıktan sonra sonucu
kırpmak, atlanan satırları geri getirmez. Yanlış satırları hesaba hiç sokmamak gerekir.

## Veritabanı yeniden oluşursa

İmleçler localStorage'da, satırlar IndexedDB'de durur. Sadece veritabanı kaybolur da localStorage kalırsa yeni veritabanı numaralara
yine 1'den başlar. Eski imleç 500 ise ilk 500 yeni yazma hiç gönderilmez. Bunun için her veritabanı bir kimlik (`instanceId`) taşır. Motor
son kullandığı kimliği saklar. Kimlik değişmişse push, pull ve yankı imleçlerinin hepsini sıfırlar.

## Ekranlar: Ortak beceri halkası

Bugün ekranında her becerinin büyük bir halkası vardı: bugünkü dakikalar plana göre dolar, ortada dokunsal bir disk, üstünde bir konuşma
balonu durur. Bu dil diğer ekranlara taşındı:

- `SkillHero` tek bir bileşendir. Halka oranı Bugün'deki `ringFraction` ile hesaplanır. Mantık kopyalanmaz.
- Balon ekranın ana eylemidir: "Okumayı başlat" ya da "Durdur · 00:42". Sayaç her zaman ortak `TimerProvider` ile çalışır, ikinci bir
  sayaç yazılmaz.
- Halkaya dokununca ayrıntı sheet'i açılır. Ekran okuyucu için etiket "Dinleme: 12 / 25 dakika. Ayrıntıyı aç" biçimindedir.
- İstatistik ekranı dört küçük halkayla (`SkillMiniRing`) açılır.
- Kartlar, satırlar ve düğmeler `tactile` seçeneğiyle alttan koyu bir kenar ve basınca aşağı inen bir durum alır. Mevcut çağrılar
  değişmez; seçenek sadece istenen yerde açılır.

Her ekranın bütün işlevleri korundu. Sadece görünüm değişti. Ekranlar 390 ve 320 piksel genişlikte, açık ve koyu temada kontrol edildi:
yatay kaydırma yok, etiketsiz düğme yok, konsol hatası yok.

## Çalışma düzeni dersleri

- **"Testler geçti" demek kanıt değildir.** Bir uygulama turu raporda "596 test geçti" yazdı ama aynı ağaçta üç test kırıktı. Sonuç
  her seferinde ayrıca çalıştırılıp dosyaya yazıldı ve oradan okundu.
- **Mutasyon kontrolü.** Bir satırı geçici olarak bozup testlerin bunu yakalayıp yakalamadığına bakmak, testin gerçekten neyi koruduğunu
  gösterir. Kart ikizi silinirken numaranın korunduğu satır bu yolla testsiz bulundu ve testi eklendi.
- **Saate bağlı testler.** Gerçek saatle çalışan bir test, iki işlem aynı milisaniyeye düşünce ara sıra kırılıyordu. Test sahte saatle
  (`vi.useFakeTimers({ toFake: ["Date"] })`) deterministik hale getirildi.
- **İki oturum aynı depoda.** İki ayrı çalışma oturumu aynı dosyalara yazınca biri ötekinin yarım işini commit'leyebilir. Bir iş
  başlarken backlog'a "şu an burada çalışılıyor" notu düşmek ve işi tek oturuma devretmek bu riski azaltır.
