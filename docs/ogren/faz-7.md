# Faz 7 öğrenme notu: iki cihazda aynı kelime, tekrar geçmişi ve iki cihazlı test düzeneği

Bu fazda yeni bir ekran yapmadık. Eşitleme motorundaki bir veri kaybı sorununu düzelttik.
Sorun sadece iki cihaz kullanınca çıkıyordu. Bu yüzden önce iki cihazı taklit eden bir test düzeneği kurduk.
Sonra sorunu o düzenekte gösterdik, düzelttik ve düzeltmeyi bağımsız inceleyicilere denetlettik.

Bu fazın asıl dersi şu: Eşitleme kodunda "testler geçiyor" demek yetmez.
Testin taklit ettiği sunucu, gerçek sunucu kadar katı değilse, test yanlış güven verir.

## Kullanılan teknolojiler ve bu projedeki rolleri

- **Vitest**: Test çalıştırıcı. Yeni bir şey eklemedik, ama sahte saat (`vi.setSystemTime`) özelliğini
  çok kullandık. Sahte saat, testte "şu an saat kaç" sorusunun cevabını bizim seçmemizi sağlar.
- **`fake-indexeddb`**: Node içinde çalışan sahte IndexedDB. Her cihaz kendi veritabanını açar.
  İki cihaz demek, iki ayrı veritabanı adı demek.
- **Sahte Supabase sunucusu**: Bizim yazdığımız bir test yardımcısı. Gerçek ağa çıkmaz.
  Bellekte tablolar tutar ve migration dosyalarındaki kuralları taklit eder.
- **FSRS kart durumu**: Bir kartın "ne zaman tekrar sorulacağı" bilgisi. İçindeki `reps` alanı,
  kartın kaç kez tekrar edildiğini sayar.

## Dosya haritası

- `src/features/sync/__tests__/twoDevices.ts`: İki cihazlı test düzeneği. Ortak sahte sunucu ve iki
  ayrı cihaz kurar. Her cihazın kendi veritabanı, kendi eşitleme motoru ve kendi saati vardır.
- `src/features/sync/__tests__/twoDevices.test.ts`: İki cihazlı senaryolar. İkiz kelime, saat kayması,
  çevrimdışı tekrarlar, üç cihaz ve "tekrar tur atınca hiçbir şey değişmez" testleri burada.
- `src/data/indexeddb.ts`: `moveCardAfterWordTwin` ve `applyRemote` içindeki ikiz yolu. Kaybeden kartın
  tekrar kayıtlarını kazanan karta taşır. `undoLastReview` içindeki yeni koruma da burada.
- `src/features/sync/engine.ts`: `adoptServerTwin`. Sunucuda aynı kelimenin kartı varsa onu benimser.
- `src/data/__tests__/twinCards.test.ts` ve `undoTwinCards.test.ts`: Tek cihazlık testler.
- `supabase/migrations/0003_sync_safety.sql`: Eski bir düzenlemeyi sessizce reddeden tetikleyici.
  Sahte sunucu bu kuralı birebir taklit eder.

## Sorun neydi

İki cihazda da internet yokken aynı kelimeyi eklediğini düşün. Telefonda "harbor", bilgisayarda "Harbor".
İki cihaz bu kelimeye farklı kimlik (id) verir. Her birinde ayrı bir kart ve ayrı tekrar kayıtları olur.

Sunucuda bir kural var: bir kullanıcının aynı kelimesi için tek canlı kart olabilir.
Bu kurala "kısmi unique indeks" denir. "Kısmi" çünkü sadece silinmemiş satırlara bakar.

İkinci cihaz eşitlerken sunucu kartı reddeder ve `23505` hatasını verir. Bu, "bu değer zaten var" demektir.
Motor da sunucudaki kartı benimser ve kendi kartını mezar taşına çevirir. Buraya kadar sorun yok.

Sorun şuydu: kaybeden kartın tekrar kayıtları hâlâ ölü kartı gösteriyordu. Yani o tekrarlar
"sahipsiz" kalıyordu. Geçmiş silinmiyordu ama hiçbir karta bağlı değildi.

## Ne yaptık

1. **Tekrar kayıtları kazanan karta taşınır.** Bir kart ikiz çakışmasını kaybedince, o karta bağlı
   bütün tekrar kayıtlarının `cardId` alanı kazanan kartın kimliğiyle değiştirilir. Değişiklik yeni bir
   zamanla damgalanır. Böylece bir sonraki eşitlemede sunucuya da gider.
2. **Sunucudaki kart her zaman kazanır.** Önce "daha çok tekrar edilmiş kart kazansın" kuralını denedik.
   Bunun için cihaz sunucudaki kartı mezar taşına çevirip kendi kartını yazıyordu. İnceleyiciler bu yolun
   üç yeni veri kaybı açtığını gösterdi. Aşağıda "Neden geri aldık" bölümünde anlatıyorum.
3. **Geri alma ölü kartı diriltmez.** "Geri al" son tekrardan önceki kart kopyasını geri yazar.
   Kart bu arada ikiz çakışmasını kaybettiyse, eski kopya ölü bir kimliği geri getirirdi.
   Artık kart canlı değilse ya da kimliği değiştiyse geri alma reddedilir.
4. **Tekrar kuyruğu sahipsiz kartları saymaz.** Kelimesi silinmiş bir kart sayılara ve süre tahminine girmez.
5. **Başlangıç kitapları ilerlemeyi ezmez.** Yeni bir cihazda oluşturulan RW1 ve RW2 satırları 1970
   tarihini taşır. "Son değiştiren kazanır" kuralında bu tarih hiçbir zaman kazanamaz. Ama eski sürümden
   (v4) gelen kopyaları birleştiren satır gerçek bir değişikliktir. O yüzden güncel bir zaman alır ve
   sunucuya gider.

## Neden geri aldık: "daha çok tekrar kazanır" yolu

Fikir doğruydu ama yöntem güvenli değildi. Yöntem sunucuya arka arkaya üç ayrı yazma yapıyordu:
önce sunucudaki kartı sil, sonra onun tekrar kayıtlarını taşı, sonra kendi kartını yaz.
İnceleyiciler üç sorun buldu:

- **Cihazın saati geride kalırsa.** Tetikleyici, cihazın verdiği zaman sunucudakinden eskiyse yazmayı
  sessizce yok sayar. Hata da vermez. Silme olmaz, kendi kartın yazılamaz. Aynı turdaki çekme işlemi ise
  çok tekrarlı yerel kartı siler.
- **Kaybeden cihazda gönderilmemiş tekrarlar varsa.** O cihazın sonraki gönderimi "eski" sayılır ve
  sessizce düşer.
- **Üç yazmanın arasında bağlantı koparsa.** Sunucuda o kelimenin hiç canlı kartı kalmaz.

Bu üç yazmanın "ya hepsi ya hiçbiri" olması gerekirdi. Buna **transaction** denir. Tarayıcıdan atılan üç
ayrı istek tek bir transaction olamaz. Doğru çözüm, birleştirmeyi sunucuda tek bir Postgres fonksiyonu
içinde yapmaktır. Bu yeni bir migration demek. Migration'ı kullanıcı çalıştırdığı için bu karar ona bırakıldı.

Bugünkü durum: Sunucudaki kart her zaman kazanır. Daha az tekrar edilmiş bir kart kazanabilir.
Ama hiçbir tekrar kaydı kaybolmaz.

## İki cihazlı test düzeneği

Eski motor testleri tek bir sahte depo ve tek bir sahte istemci kullanıyordu. İkiz sorunu bu testlerde
görünmez, çünkü sorun iki cihazın birbirine değdiği yerde çıkar.

Yeni düzenek şunları yapar:

- **Sunucu zamanı kendisi verir.** Her yazmada `updated_at` sunucu saatinden gelir. Tek bir istekteki
  bütün satırlar aynı zamanı alır. Gerçek Postgres'te de `now()` transaction başına tek bir değerdir.
- **0003 tetikleyicisini taklit eder.** Eski düzenleme hata vermeden yok sayılır.
- **Kısmi unique indeksleri taklit eder.** Aynı kelimenin ikinci canlı kartı `23505` alır.
- **Her cihazın kendi saati vardır.** Bir cihazın saatini sunucudan 5 saniye geri ya da ileri alabiliriz.

İlk sürümde her cihazın saati sunucudan hep ilerideydi. Bu yüzden tetikleyicinin reddettiği hiçbir durum
test edilmiyordu. Testler geçiyordu ama yanlış güven veriyordu. Saat kontrolü eklenince sorunlar göründü.

## Yeni kavramlar

### Kısmi unique indeks
"Bu sütunda aynı değer iki kez olamaz, ama sadece silinmemiş satırlar için" kuralı. Mezar taşı satırları
kurala girmez. Bu yüzden bir kelimeyi silip yeniden ekleyebilirsin.

### Sessiz reddetme
Tetikleyici eski bir yazmayı reddederken hata vermez, eski satırı olduğu gibi bırakır. Bu, eşitleme
döngülerini engeller. Ama istemci "yazdım" sanır. Bu yüzden "hata gelmedi" demek "veri sunucuda" demek değildir.

### Saat kayması (clock skew)
İki makinenin saati hiçbir zaman tam aynı değildir. Bir telefon birkaç saniye geride olabilir.
Zamanla karar veren her kod, bu farkı hesaba katmalıdır. En güvenli yol: kararı tek bir saate bırakmak.
Bizde bu saat sunucudur.

### Transaction
Birden çok değişikliği tek bir paket gibi yapmak. Ya hepsi olur ya hiçbiri. IndexedDB'de tek bir cihaz
içinde transaction kullanırız. Ama cihaz ile sunucu arasında ortak bir transaction yoktur.

## Kendin dene

1. `twoDevices.test.ts` içindeki "loser clock 5 s behind server" satırında `skewMs` değerini `-5000`'den `-60000`'e çevir.
   Testi çalıştır: `npx vitest run src/features/sync/__tests__/twoDevices.test.ts`. Sonuç değişiyor mu? Neden?
2. `twoDevices.ts` içinde, aynı istekteki satırlara ayrı zaman veren eski davranışı geri getir.
   Hangi test hâlâ geçiyor? Bu sana sahte sunucunun neden katı olması gerektiğini gösterir.
3. Kâğıt üzerinde çiz: A cihazı "harbor" kelimesini 1 kez, B cihazı 3 kez tekrar etti. A önce eşitledi.
   Son durumda hangi kart kalır, tekrar kayıtları hangi kartı gösterir?

## Kendini sına

1. İki cihaz aynı kelimeyi ekleyince sunucu neden `23505` hatası verir?
2. Kaybeden kartın tekrar kayıtları neden silinmez de taşınır?
3. "Hata gelmedi" neden "yazma başarılı" demek değildir? Hangi dosyadaki hangi kural buna yol açar?
4. Tarayıcıdan atılan üç ayrı istek neden tek bir transaction gibi güvenli olamaz?
5. Yeni cihazdaki başlangıç kitabı neden 1970 tarihini taşır, ama birleştirilen kitap satırı neden taşımaz?
