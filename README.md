# Bali Camera Desk

A lightweight browser viewer combining the [Denpasar ATCS catalogue](https://atcs.denpasarkota.go.id/streaming), [Bali Satu Data](https://balisatudata.baliprov.go.id/peta-cctv), and the CCTV location layer of the [Badung Smart City map](https://map.badungkab.go.id/). Camera ownership is not consistently exposed by the aggregators; source labels identify the publishing portal.

## Run locally

Requires Node.js 20 or newer. No package installation or build is needed.

```sh
cd denpasar-viewer
npm start
```

Open http://127.0.0.1:4173. Use `PORT=8080 npm start` to choose another port. Opening index.html directly does not work because browsers restrict local JSON/module loading.

## Use the viewer

- Cari nama CCTV atau jalan langsung di atas peta. Buka **Filter** untuk memilih sumber, lokasi, kawasan, dan SPBU; **Selesai** menutup panel tanpa menghapus filter. **Reset semua** menghapus pencarian dan filter.
- Pilih **Sumber CCTV** untuk menampilkan Denpasar, Bali Satu Data/Pemprov Bali, atau Peta Smart City/Pemkab Badung. Label sumber tampil di kartu dan popup peta.
- Klik **Sunset Road**, pilih kawasan **Sekitar Sunset Road**, atau ketik tepat **Sunset Road** pada pencarian. Kamera dan SPBU disaring berdasarkan jarak ke segmen jalan terdekat, bukan kecocokan nama. Pilih jarak 250 m–5 km. Garis ungu menandai koridor jalan; nama kamera yang tidak menyebut Sunset Road tetap bisa muncul.
- Choose 4, 9, or 16 cameras per page. Use the page controls to reach the entire catalogue.
- Play individual feeds or connect the whole visible page. Changing pages or filters stops the previous page's streams.
- Star cameras to save favorites in this browser. Favorites stay on this device.
- Expand a camera for a large view, or use the map link to find its junction.
- Gulir roda mouse untuk zoom, tarik untuk menggeser peta, atau gunakan pinch pada layar sentuh.
- Explore the interactive map: green camera pins open the available streams at a junction; amber fuel pins show SPBU information and a button to find nearby cameras.
- Enable **CCTV dekat SPBU** to filter by the nearest mapped fuel station, or select a particular SPBU. Choose a radius from 250 m to 5 km. Matching cameras are sorted by distance, and the map shows all matching cameras across every page.
- Camera search, location filters, and favorites combine with the SPBU filter. **Reset SPBU** clears only the fuel filter. **Tutup peta** hides the map while keeping the filters available.
- Stop all streams when finished. Feed status reflects actual playback; unavailable feeds offer retry and an official-player link.

Live video comes directly from the city's public HTTPS HLS endpoints. Internet access is required. Availability and footage are controlled by Denpasar ATCS. Playing many cameras at once consumes bandwidth and device resources. This viewer is independent of the city and does not record video or provide camera control.

Katalog Bali Satu Data memuat status sumber `unknown`. Kamera HLS Pemprov ditampilkan melalui pemutar resmi yang dapat disematkan, karena server medianya mengirim header CORS ganda yang menghalangi pemutaran langsung lintas situs. Status iframe diberi label **Pemutar resmi**, bukan live; keberhasilan memuat halaman tidak memastikan videonya tersedia. Tujuh URL video publik Buleleng memakai video browser. Tautan/katalog tidak berarti semua kamera sedang online. Peta Badung menyediakan titik kamera, tetapi empat konfigurasi stream lamanya tidak menghasilkan feed HTTPS yang terverifikasi; titik tanpa feed publik diberi label **Lokasi terdaftar**, bukan live. Klik **Info** untuk membuka sumber resmi. Tidak ada koneksi RTSP/RTMP atau akses ke perangkat internal.

Kamera dengan URL feed yang sama digabung. Entri lokasi tanpa feed juga digabung dengan kamera bersiaran dari portal lain hanya jika nama tempat cocok setelah penghapusan kode/annotasi dan koordinat berjarak maksimum 10 m. Atribusi kedua portal dipertahankan di filter sumber. Sudut kamera yang berbeda tetap dipertahankan.

## Refresh the catalogue

```sh
npm run sync
```

This reads the same public camera catalogue as the official page and saves only camera names, descriptions, map coordinates, and public HTTPS playback URLs. Upstream device configuration and web-client headers are never saved. A failed refresh preserves the current catalogue. If the official website changes its page/API format, the sync script may need an update. Re-publish the static site after syncing to update its hosted catalogue.

Perbarui katalog Pemprov Bali dan peta Badung secara terpisah:

```sh
npm run sync:sources
```

Katalog tambahan disimpan di `dist/additional-cameras.json`, terpisah dari Denpasar sehingga refresh Denpasar tidak menghapus sumber lain. Proses Badung menggunakan sesi publik serta CSRF normal dari halaman resminya; cookie dan token hanya disimpan sementara dalam memori, tidak dicatat atau dikirim ke browser viewer. Jika salah satu sumber gagal, snapshot sumber tersebut dipertahankan.

Perbarui geometri Sunset Road dari OpenStreetMap:

```sh
npm run sync:roads
```

## Peta dan data SPBU

Peta menggunakan Leaflet dan ubin OpenStreetMap. Data titik SPBU disimpan di `dist/fuel-stations.json` dari objek OpenStreetMap bertag `amenity=fuel`, termasuk pom bensin kecil yang dipetakan warga. Cakupan meliputi Denpasar, koridor Sunset Road, dan sekitarnya; bukan seluruh pulau Bali. Data mungkin belum lengkap atau akurat dan bukan daftar resmi SPBU. Nama yang belum tersedia diberi label generik; tautan setiap titik mengarah ke data sumbernya di OpenStreetMap.

Jarak memakai rumus Haversine (garis lurus), bukan rute berkendara. Kamera yang dekat SPBU belum tentu menghadap ke SPBU. Untuk objek SPBU berbentuk area, posisi memakai pusat batas area dari Overpass sehingga jarak bersifat perkiraan.

Perbarui data SPBU (jalankan lagi setelah memperluas katalog kamera):

```sh
npm run sync:spbu
```

Proses mengambil data lewat Overpass API dan mempertahankan snapshot sebelumnya jika gagal. Filter memakai snapshot lokal, sehingga tidak memerlukan permintaan Overpass saat membuka aplikasi. Latar peta dan video tetap memerlukan internet. Jika ubin peta gagal dimuat, filter dan daftar kamera tetap dapat dipakai.

Data dan peta: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), tersedia berdasarkan Open Database License. Jangan menghapus atribusi pada peta. Penggunaan layanan ubin mengikuti [Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/).

## Validate

```sh
npm test
```

Static files are in `dist/` and may be served by any static web host. HLS.js 1.6.13 is bundled under its Apache 2.0 license in `dist/assets/hls.LICENSE`; Safari can use native HLS playback. Leaflet 1.9.4 is bundled under its BSD 2-Clause license in `dist/assets/leaflet/LICENSE`. No package installation or API key is required.
