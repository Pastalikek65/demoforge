# Türkçe hızlı başlangıç

DemoForge, tarayıcıdaki bir iş akışını kaydedip yeniden oynatır; gerçek video, GIF ve ekran görüntülü rehber üretir. Henüz geliştirme aşamasındadır; v1 yayımlanmamıştır.

Node.js 22+ ve libx264 destekli FFmpeg kurulu olmalı. FFmpeg PATH üzerinde değilse `DEMOFORGE_FFMPEG` ortam değişkenini tam dosya yoluna ayarla.

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

`artifacts/shop-demo/guide.html` dosyasını ve videoları aç. Masaüstü editör için `npm start` kullan. İş akışını ayrı tarayıcıda kaydet, editörden durdur, adımları düzenle ve yeniden oynat.

Ham kayıtlar hassas veri içerebilir. Gizleme alanlarını ekle ve paylaşmadan önce üretilen çıktıları incele. Parolalar proje dosyasında değer olarak saklanmaz; yeniden oynatırken editörden veya `DEMOFORGE_VAR_<NAME>` ortam değişkeninden verilir. Çıktı klasörü yeni olmalıdır; mevcut dosyaların üzerine yazılmaz.
