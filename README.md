# Piksel Palet Stüdyosu

Kullanıcının seçtiği bir görseli piksel bloklarına ayıran ve sonucu 2-8 renkli sınırlı bir paletle yeniden oluşturan tarayıcı uygulaması.

## GitHub Pages ile yayınlama

Bu proje build gerektirmez; dosyalar doğrudan GitHub Pages üzerinden çalışır.

1. GitHub'da yeni bir repository oluşturun.
2. Bu klasörü repository'ye push edin.
3. Repository ayarlarında `Settings > Pages` bölümüne girin.
4. `Build and deployment > Source` alanını `GitHub Actions` yapın.
5. `main` branch'e her push sonrası site otomatik yayınlanır.

GitHub CLI kullanıyorsanız:

```bash
git init
git add .
git commit -m "Add pixel palette web app"
gh repo create piksel-palet-studyosu --public --source=. --remote=origin --push
```

Yayın adresi genellikle şu formatta olur:

```text
https://KULLANICI_ADI.github.io/piksel-palet-studyosu/
```

## Yerelde çalıştırma

`index.html` dosyası doğrudan tarayıcıda açılabilir.

Yerel sunucu ile denemek için:

```bash
python3 -m http.server 5173
```

Sonra `http://127.0.0.1:5173` adresini açın.

## Özellikler

- Görsel yükleme veya sürükle-bırak
- 2-80 px arası blok boyutu
- Çıktıyı tam ızgaraya tamamlayarak tüm pikselleri eşit boyutta tutma
- Önizlemeyi tam sayı hücre ölçeğiyle gösterme
- Görünür blokları tam dolu kareler halinde üretme
- 2, 3, 4, 5, 6, 7 veya 8 renkli çıktı
- Oluşturulan paleti ve her renkten gereken parça adedini görüntüleme
- Izgara açma/kapatma
- PNG olarak indirme
