# Faz 9 öğrenme notu: Tek transaction'da kart ve log eşitleme, soyağacı yürüyüşü ve migration 0004

Bu fazda eşitleme (sync) mimarisinin en kritik konusunu ele aldık: bir kart ve ona ait tekrar kayıtlarının (review logs) ağ üzerinden tutarlı biçimde sunucuya aktarılması.
Önceki fazlarda kart ve tekrar logları iki ayrı HTTP isteğiyle gönderiliyordu. Ancak tarayıcı ile sunucu arasındaki iki ayrı istek tek bir veritabanı transaction'ı olamadığı için çeşitli yarım durumlar (half states) ve veri tutarsızlıkları ortaya çıkıyordu.

Bu fazın asıl dersi şu: Eşitleme sistemlerinde karşılaşılan her özel senaryo için ayrı bir kural (case rule) yazmak sonu gelmeyen bir kovalamacadır. Her inceleme turu bu kuralların açıkta bıraktığı yeni bir sıra buldu; ta ki soyağacı yürüyüşü (lineage walk) gibi tek ve genel bir kural tüm özel durumların yerini alana kadar.

## Kullanılan teknolojiler ve bu projedeki rolleri

- **PostgreSQL / Supabase RPC**: `eng_push_card_bundle` ve `eng_merge_card` fonksiyonları. İstemciden gelen kart ve logları tek bir transaction içinde işler.
- **Postgres Danışma Kilitleri (`pg_advisory_xact_lock`)**: Kullanıcı, kart ve kelime bazında eşzamanlı çakışmaları ve yarış durumlarını (race conditions) engeller.
- **Soyağacı Yürüyüşü (Lineage Walk)**: Tekrar kayıtlarındaki `previous_card` durumlarını geriye doğru tarayarak sunucu durumu ile istemci durumunun ortak atada buluşup buluşmadığını kesinleştiren algoritma.
- **Vitest & fake-indexeddb**: İki cihazlı test düzeneğinde ağ kopmaları, saat kaymaları ve geri alma (undo) senaryolarını test eder.

## Dosya haritası

- `supabase/migrations/0004_card_merge.sql`: `eng_card_redirects` yönlendirme tablosu, `eng_merge_card` ve `eng_push_card_bundle` fonksiyonları, `eng_guard_card_reps`, `eng_guard_review_log_undo` ve `eng_redirect_review_log` tetikleyicileri.
- `src/features/sync/engine.ts`: Kart ve logları tek paket halinde sunucuya ileten `pushCardBundles`, çekme (pull) sırasında bekleyen yerel satırları koruma mantığı ve migration 0004 çalıştırılmamışsa devreye giren geri düşüş (fallback) mekanizması.

## Sorun neydi: İki ayrı istek neden tek transaction olamaz?

Bir kart tekrar edildiğinde iki parça veri üretilir:
1. Kartın güncel FSRS durumu (`reps`, `stability`, `due_at` vb.).
2. Tekrarın kanıtı olan log satırı (`eng_review_logs`).

İstemci kartı ve tekrar logunu iki ayrı HTTP isteğiyle gönderdiğinde, ağ seviyesinde bu iki istek arasında "ya hepsi ya hiçbiri" garantisi (transaction) verilemez. Bu durum şu yarım durumlara (half states) yol açıyordu:

- **Logsuz kart (card without its log):** Kart güncellenir fakat log isteği ağ kopması nedeniyle sunucuya ulaşamaz. Kartın tekrar sayısı artmış görünür ama sunucuda o tekrarın geçmiş kaydı bulunmaz.
- **Yeniden puanlama sonrası mezar taşı (tombstone after a re-rate):** Kullanıcı bir puanlamayı geri alıp (undo) hemen yeni bir puan verdiğinde, silinen logun mezar taşı ile yeni log ve kart durumu ayrı isteklerle giderse sunucu bu olayların sırasını şaşırabilir.
- **Sunucunun hiç görmediği bir log için mezar taşı (tombstone for a log the server never saw):** Çevrimdışıyken yapılan bir tekrar yine çevrimdışıyken geri alınırsa, sunucuya daha önce hiç gitmemiş bir log için mezar taşı gönderilir ve sunucunun kafası karışır.

### Cihaz saatleri ve `reps` sayıları neden karar veremez?

- **Cihaz saatleri güvenilmezdir:** Cihazların saatleri ileri veya geri olabilir (clock skew). Yalnızca zaman damgasına bakarak karar vermek, saati ileride olan bir cihazın eski veya hatalı durumunun doğru durumu ezmesine neden olur.
- **`reps` (tekrar sayısı) tek başına yetersizdir:** Geri alma (undo) işlemi tekrar sayısını 1 azaltır. Eğer kural sadece "daha çok tekrarı olan kazanır" olsaydı, geçerli bir geri alma işlemi sunucu tarafından "eski/düşük reps" sanılarak daima reddedilirdi.

## Çözüm: `supabase/migrations/0004_card_merge.sql`

Sorunların çözümü için sunucu tarafında atomik çalışan bir yapı kuruldu:

1. **`eng_push_card_bundle`**: Kartı ve ilişkili tüm logları tek bir Postgres transaction'ı içinde alır. Danışma kilidiyle yarış durumlarını önler. Kart ve loglar birlikte değerlendirilir; yarım durum oluşamaz.
2. **`eng_merge_card` ve `eng_card_redirects`**: Aynı kelime için farklı kart kimlikleri oluştuğunda (örneğin iki cihazda çevrimdışı ekleme):
   - Daha çok tekrarı (`reps`) olan kart durumu kazanır.
   - Ancak sunucudaki kimlik (`canonical_id`) korunur.
   - Kaybeden kimlik `eng_card_redirects` tablosuna kaydedilir.
   - Kaybeden kartın tüm logları kazanan kimliğe taşınır (`card_id` güncellenir).
   - Gecikmeli gelen loglar `eng_redirect_review_log` tetikleyicisiyle otomatik olarak doğru karta yönlendirilir.
3. **Soyağacı Yürüyüşü (Lineage Walk)**:
   - Her tekrar kaydının `previous_card` alanı, o tekrardan hemen önceki kart durumunu saklar.
   - Sunucu, gelen durumdan ve depolanmış mevcut durumdan geriye doğru (`previous_card` üzerinden) ortak bir ataya yürür.
   - Zaman damgaları yalnızca **birebir eşitlik** kontrolü için kullanılır, büyüklük/küçüklük kıyaslaması yapılmaz.
   - Bir logun silinmesi (mezar taşı / tombstone), yalnızca o log sayılan aktif soyağacı zincirinin dışındaysa kabul edilir.
   - Sunucuda önceden kesinleşmiş bir mezar taşı asla yeniden diriltilemez.

## İstemci tarafı (`src/features/sync/engine.ts`)

- **Paket Gönderimi (`pushCardBundles`)**: İstemci artık kart ve logları ayrı ayrı göndermek yerine `eng_push_card_bundle` RPC fonksiyonuyla tek seferde gönderir.
- **Bekleyen Satırların Korunması (Pending rows)**: Sunucudan yapılan çekme (`pullStore`) sırasında, henüz sunucuya gönderilmemiş yerel değişiklikler (`isPending`) uzaktan gelen verilerle ezilmez.
- **Geri Düşüş (Fallback)**: Migration 0004 henüz veritabanında çalıştırılmamışsa (RPC fonksiyonu bulunamadığında: `PGRST202` veya `42883`), motor hata verip durmak yerine sessizce eski usul bağımsız mağaza gönderimine (`pushStore`) geri düşer.

## En önemli ders: Özel kurallardan genel kurala

İlk sürümlerde karşılaşılan her uç senaryo için ayrı bir `if-else` kuralı yazılmıştı. Ancak her inceleme turunda bu kuralların gözden kaçırdığı yeni bir işlem sırası bulundu.
Sonunda tüm bu özel kuralların yerini **soyağacı yürüyüşü (lineage walk)** aldı. Kart durumlarının `previous_card` ile birbirine bağlanması, karmaşık senaryoları ortak ata doğrulamasına indirgeyerek sistemi güvenli hale getirdi.

## Bilinen sınırlar

- **Birleşme sırasında kaybeden ikiz kartta geri alma:** İkiz kart birleşmesi sırasında kaybeden koldaki geri alma (undo) işlemi bazen karşı tarafa yansıtılamayabilir.
- **Çatallanan geçmişlerde log sayısı:** Dallanmış geçmişlerde (branched histories), canlı log satırlarının toplam sayısı kartın `reps` değerini aşabilir.
- **Gerçek Postgres doğrulaması:** Migration 0004 kodu henüz canlı bir Postgres veritabanında çalıştırılmamıştır (testler taklit sunucu üzerinde yapılmıştır).

## Yeni kavramlar

### Soyağacı Yürüyüşü (Lineage Walk)
Loglardaki `previous_card` kopyalarını izleyerek şimdiki durumdan geriye doğru ortak ata durumunu arayan doğrulama yöntemi.

### Paket İstek (Bundle)
Kartı ve ona ait logları sunucuya tek bir istekte ve atomik bir transaction ile gönderen RPC yapısı.

### Yönlendirme Tablosu (`eng_card_redirects`)
Kaybeden kart kimliklerini kazanan karta bağlayarak, sonradan gelen logların yetim kalmasını önleyen kalıcı eşleme tablosu.

## Kendin dene

1. `src/features/sync/engine.ts` içindeki `pushCardBundles` fonksiyonunda `eng_push_card_bundle` çağrısının yerine bilerek `PGRST202` hatası fırlatan bir satır ekle. Motorun eski usul `pushStore` akışına sorunsuz biçimde geri düştüğünü gör.
2. Bir kartı çevrimdışıyken tekrar et, ardından hemen geri al (undo). Üretilen log satırındaki `deleted_at` ve `previous_card` alanlarını incele.
3. İki cihazlı testlerde bir kartın ikiz birleşimi sonrası eski `card_id` ile gelen logların `eng_redirect_review_log` ile nasıl kazanan kimliğe taşındığını doğrula.

## Kendini sına

1. Kart ve tekrar kaydı iki ayrı HTTP isteğiyle gönderildiğinde neden ortak bir transaction oluşturulamaz?
2. Tekrar sayısı (`reps`) daha yüksek olan durumu seçmek tek başına neden yeterli bir eşitleme kuralı değildir?
3. Soyağacı yürüyüşünde (lineage walk) zaman damgaları neden büyüklük/küçüklük için değil de sadece eşitlik için kıyaslanır?
4. Sunucuda kesinleşmiş bir mezar taşı (tombstone) neden sonradan gelen bir istemci paketiyle diriltilemez?
5. `eng_card_redirects` tablosu olmasaydı, ikiz birleşimi tamamlandıktan sonra ağ gecikmesiyle gelen eski loglara ne olurdu?
