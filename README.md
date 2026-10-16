# Denpasar Camera Desk

A lightweight browser viewer for all public CCTV feeds in the [Denpasar ATCS catalogue](https://atcs.denpasarkota.go.id/streaming). The initial catalogue contains 164 cameras at 109 locations, checked on 16 October 2026.

## Run locally

Requires Node.js 20 or newer. No package installation or build is needed.

```sh
cd denpasar-viewer
npm start
```

Open http://127.0.0.1:4173. Use `PORT=8080 npm start` to choose another port. Opening index.html directly does not work because browsers restrict local JSON/module loading.

## Use the viewer

- Search by camera name, junction, or street, or filter by location.
- Choose 4, 9, or 16 cameras per page. Use the page controls to reach the entire catalogue.
- Play individual feeds or connect the whole visible page. Changing pages or filters stops the previous page's streams.
- Star cameras to save favorites in this browser. Favorites stay on this device.
- Expand a camera for a large view, or use the map link to find its junction.
- Explore the interactive map: green camera pins open the available streams at a junction; amber fuel pins show SPBU information and a button to find nearby cameras.
- Enable **CCTV dekat SPBU** to filter by the nearest mapped fuel station, or select a particular SPBU. Choose a radius from 250 m to 5 km. Matching cameras are sorted by distance, and the map shows all matching cameras across every page.
- Camera search, location filters, and favorites combine with the SPBU filter. **Reset filter SPBU** clears only the fuel filter. **Sembunyikan peta** hides the map while keeping the filters available.
- Stop all streams when finished. Feed status reflects actual playback; unavailable feeds offer retry and an official-player link.

Live video comes directly from the city's public HTTPS HLS endpoints. Internet access is required. Availability and footage are controlled by Denpasar ATCS. Playing many cameras at once consumes bandwidth and device resources. This viewer is independent of the city and does not record video or provide camera control.

## Refresh the catalogue

```sh
npm run sync
```

This reads the same public camera catalogue as the official page and saves only camera names, descriptions, map coordinates, and public HTTPS playback URLs. Upstream device configuration and web-client headers are never saved. A failed refresh preserves the current catalogue. If the official website changes its page/API format, the sync script may need an update. Re-publish the static site after syncing to update its hosted catalogue.

## Peta dan data SPBU

Peta menggunakan Leaflet dan ubin OpenStreetMap. Data titik SPBU disimpan di `dist/fuel-stations.json` dari objek OpenStreetMap bertag `amenity=fuel`, termasuk pom bensin kecil yang dipetakan warga. Cakupan mencakup area CCTV Denpasar dan sekitarnya. Data mungkin belum lengkap atau akurat dan bukan daftar resmi SPBU. Nama yang belum tersedia diberi label generik; tautan setiap titik mengarah ke data sumbernya di OpenStreetMap.

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
