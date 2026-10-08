# Türkçe hızlı başlangıç

DemoForge, tarayıcıdaki bir iş akışını kaydedip yeniden oynatır; gerçek video, GIF ve adım adım rehber üretir. Kayıt ve dışa aktarma yerel bilgisayarında gerçekleşir; hesap veya ücretli API gerekmez. 1.0.0 paketleri Windows x64 ve Ubuntu 24.04 x64 üzerinde temiz kurulum, kayıt, yeniden oynatma ve dört çıktı formatı için kabul testlerini geçti. [DemoForge 1.0.0 indir](https://github.com/Pastalikek65/demoforge/releases/tag/v1.0.0); arşivi açmadan önce sürümdeki `SHA256SUMS.txt` ile dosya özetini doğrula.

Kaynak depodan çalıştırmak için Node.js 24 LTS ve libx264 destekli FFmpeg kur. FFmpeg PATH üzerinde değilse `DEMOFORGE_FFMPEG` ortam değişkenini tam dosya yoluna ayarla. Masaüstü paketini kullanıyorsan Node.js gerekmez; FFmpeg yine ayrıca kurulur.

```sh
npm ci
npm run browser:install
npm run build
node examples/shop/server.mjs
```

İkinci terminalde örneği çalıştır:

```sh
node dist/cli.js replay examples/shop/workflow.demoforge.json --output artifacts/shop-run
node dist/cli.js export examples/shop/workflow.demoforge.json --run artifacts/shop-run/run.json --output artifacts/shop-demo --reviewed
```

`artifacts/shop-demo/guide.html` dosyasını ve videoları aç. Masaüstü editör için `npm start` kullan. İş akışını ayrı tarayıcıda kaydet, editörden durdur, adımları düzenle ve yeniden oynat. Paket kurulumunda ilk açılışta **Install browser** düğmesiyle Chromium'u indir; bu tek seferlik işlem internet bağlantısı gerektirir.

Masaüstü paketini ilk açışında **Install browser** düğmesiyle resmi tarayıcı dosyalarını indir. Bu tek seferlik adım internet gerektirir; sonraki işlemler yerelde çalışır. FFmpeg ayrıca kurulur. Windows ZIP paketleri imzasızdır. Linux kurulumunda Electron sandbox yardımcısının sistem kurulumu gerekir; [paketleme rehberindeki](packaging.md) adımları izle.

URL içindeki bilinen token, parola ve OAuth alanları gizli çalışma değişkenine dönüştürülür. Yeniden oynatırken tam URL’yi gir; bu değer proje JSON’una yazılmaz. Önceki geliştirme sürümünden kalan gizli URL’leri düz değer olarak içeren projeler, çalışma değişkenine çevrilmeden açılmaz. Eski parmak izsiz run.json kayıtları için yeniden oynat.

Ham kayıtlar hassas veri içerebilir. Gizleme alanlarını ekle ve paylaşmadan önce üretilen çıktıları incele. Parolalar proje dosyasında değer olarak saklanmaz; yeniden oynatırken editörden veya `DEMOFORGE_VAR_<NAME>` ortam değişkeninden verilir. Çıktı klasörü yeni olmalıdır; mevcut dosyaların üzerine yazılmaz.
