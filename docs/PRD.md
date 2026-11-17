# PRD: terrasea-stock

Versi 0.1 | Status: draf untuk disetujui tim | Pemilik: tim terrasea-stock (UPI, Sistem Informasi Kelautan)

> Tag **[KEPUTUSAN]** = sudah diputuskan di dokumen ini. Tag **[VALIDASI]** = perlu dikonfirmasi tim (terutama Nazma untuk ML, Devina untuk ekologi) sebelum dibangun.

## 1. Ringkasan

terrasea-stock adalah WebGIS yang memetakan zona perairan pesisir Banten, menampilkan estimasi MSY dan TAC bulanan per zona, serta indikator kelimpahan tiga kelompok ikan (pelagis besar, pelagis kecil, demersal). Produk utamanya: **peta zona + model hibrida statistik-ekologi** dengan keluaran hindcasting dan prakiraan satu bulan ke depan.

Pertanyaan inti yang harus terjawab dalam 30 detik: *"Di zona pesisir Banten mana, bulan ini, kelompok ikan apa yang relatif berlimpah, dan berapa batas tangkap yang wajar?"*

## 2. Pengguna

| Persona | Kebutuhan | Page utama |
|---|---|---|
| Pengelola perikanan (mis. DKP Banten) | Batas tangkap bulanan per zona | Marine Stock, Stock Prediction |
| Peneliti / mahasiswa | Data olahan, metode, dan error model | Stock Prediction, Download Data |
| Admin tim | Memantau akun, unduhan, versi model | Dashboard |

Nelayan bukan target v1 (butuh antarmuka seluler sederhana, masuk v2).

## 3. Glosarium (wajib konsisten di UI)

- **MSY**: hasil tangkapan maksimum lestari (ton/bulan) yang diestimasi per kelompok ikan.
- **TAC**: batas tangkap yang dianjurkan. **[KEPUTUSAN]** `TAC = 0,8 x MSY` (faktor kehati-hatian, nilai di `config`, bukan hardcode).
- **Hindcasting**: model memprediksi periode masa lalu yang tidak dipakai melatih (data uji 15%) untuk dibandingkan dengan data aktual. Ini bukti akurasi model.
- **Forecast**: prakiraan bulan berikutnya. Selalu diberi label berbeda dari hindcast.
- **Zona**: poligon perairan hasil klaster, menempel pesisir, <= 350 ha.
- **Indeks kelimpahan**: kelas relatif (sangat berlimpah / berlimpah / kurang berlimpah), **bukan** jumlah ikan absolut.

## 4. Keputusan sains

1. **Ukuran zona [KEPUTUSAN].** Batas keras 350 ha per zona, 5-7 zona, wajib bersinggungan dengan garis pantai. Angka 400 ha di draf awal dibuang. Catatan jujur untuk UI: cakupan total <= 2.450 ha, jadi ini "zona prioritas pesisir", bukan seluruh perairan Banten.
2. **Asal MSY [KEPUTUSAN, VALIDASI].** PLS memprediksi `catch_ton` per kelompok ikan dari effort, lag ekologi, dan musim. MSY bulanan diturunkan dengan *effort sweep*: nilai effort divariasikan dalam rentang yang pernah teramati (tanpa ekstrapolasi) dengan kondisi lingkungan bulan itu tetap, lalu diambil puncak prediksi tangkapan. Alternatif cadangan: Schaefer/Fox berbasis CPUE.
3. **Alokasi ke zona [KEPUTUSAN, VALIDASI].** Data tangkapan berskala wilayah, bukan per zona. MSY wilayah dibagi ke zona sebanding dengan skor kesesuaian habitat tiap zona. UI wajib menyatakan bahwa nilai zona adalah alokasi, bukan pengukuran.
4. **Makna "hibrida" [KEPUTUSAN].** Tiga komponen digabung: (a) PLS statistik untuk besaran tangkapan, (b) indeks kesesuaian habitat ekologis (SST, klorofil, arus, terumbu karang, lamun) untuk distribusi spasial dan kelas kelimpahan, (c) klaster spasial untuk bentuk zona.
5. **Kelas kelimpahan [KEPUTUSAN, VALIDASI].** v1 berbasis aturan: skor kesesuaian habitat per kelompok ikan dibagi dengan ambang (default tertil historis, diganti ambang literatur bila Devina menyediakan). Pengklasifikasi ML baru boleh ditambah di v2 setelah ada data validasi. UI menulis "Indeks berbasis aturan".
6. **Evaluasi [KEPUTUSAN].** Split kronologis 85/15, scaler hanya di-fit pada data latih, `n_components` dipilih lewat cross-validation deret waktu (bukan tetap 4), laporkan RMSE dan MAE per kelompok ikan, tampilkan di grafik.

## 5. Ruang lingkup per page

**Landing (publik).** Slide fitur, penjelasan 2 kolom, header lengket, footer "jump to feature". Teks footer sesuai skema awal.

**Marine Stock.**
- Peta Banten, basemap Dataviz, sidebar buka-tutup.
- Layer: SST, klorofil, kecepatan arus (hasil interpolasi), tombol "Eco" menampilkan zona.
- Daratan menutup paling atas, zona satu layer di bawahnya.
- Rentang waktu H-3..H+3: kontrol pemilihan 7 hari (H-3, H-2, H-1, Hari ini, H+1, H+2, H+3) dengan label jelas "Terukur" vs "Prakiraan (LSTM)" menggunakan kombinasi simbol dan teks. Menampilkan tanggal (font mono) dan info "Data terukur terakhir: <tanggal>". Bila data terukur terakhir tertinggal > 7 hari dari hari ini, sistem menampilkan penanda peringatan usang (stale).
- Klik zona: sidebar terkunci, pinbox berisi alokasi MSY, TAC, tiga indikator kelimpahan, tombol lihat terumbu karang dan lamun, musim bulan itu. Tombol silang membuka kunci dan kembali ke pemilihan zona.
- Klik titik pada peta (di luar daratan): pinbox titik memuat nilai hasil interpolasi bilinear murni di sisi klien (< 1 detik) untuk klorofil-a, SST, kecepatan dan arah arus dari komponen uo/vo, keterangan stasiun asal, galat leave-one-out IDW, serta RMSE prakiraan LSTM untuk hari prakiraan. Di dalam zona terpilih, pinbox titik juga memuat tiga indikator kelimpahan.
- Indikator: ▲ hijau = sangat berlimpah, = kuning = berlimpah, ▼ merah = kurang berlimpah (simbol + warna).

**Stock Prediction.** Wajib pilih zona dulu. Grafik 10 bulan terakhir tangkapan vs MSY, hindcast, forecast, dan panel RMSE/MAE. Tab parameter: Klorofil, SST, kecepatan arus plus arah mata angin (mawar angin).

**Download Data.** Minimap, filter jenis data, periode, kelompok ikan (muncul hanya jika jenis = MSY), unduh `.xlsx`.

**About.** Profil UPI dan prodi, kartu tim: Aqill (Website Developer), Devina (Ecosystem Knowledge Management), Najla (Design Graphic), Nazma (Data & Machine Learning).

**Dashboard (admin).** v1: jumlah akun, antrean verifikasi, log unduhan, versi model aktif dan tanggal `generated_at`.

## 6. Fitur akun

- Register dengan verifikasi email sebelum akun aktif.
- Sesi logout otomatis setelah 20 menit tanpa aktivitas.
- Pengunjung anonim hanya boleh membuka Landing, sisanya redirect ke login.

## 7. Kriteria penerimaan

- Tidak ada zona > 350 ha dan semua zona menyentuh garis pantai (diuji skrip validasi geometri).
- Klik zona memunculkan pinbox < 1 detik pada koneksi biasa.
- 7 hari pada rentang waktu H-3..H+3 tampil dengan label Terukur/Prakiraan yang jelas (simbol + teks).
- Nilai titik klik tampil < 1 detik (lookup dihitung di klien).
- Nilai RMSE dan MAE prakiraan harian LSTM tampil di antarmuka legenda dan pinbox.
- Grafik Stock Prediction selalu memuat label hindcast/forecast, `model_version`, RMSE, MAE.
- Tidak ada nilai prediksi negatif (klorofil dan kecepatan arus dijepit >= 0).
- Akses tanpa sesi ke endpoint non-publik mengembalikan 401 dan redirect.
- Sesi berakhir tepat 20 menit tidak aktif (uji otomatis).
- File Excel unduhan memuat sheet metadata (sumber, periode, versi model, catatan limitasi).
- Semua indikator bisa dibaca tanpa warna (simbol tersedia) dan kontras teks >= 4,5:1.

## 8. Non-goals v1

Prediksi stok lebih dari 1 bulan (tetap non-goal; prakiraan harian hanya mencakup horizon terbatas H-3..H+3), data per kapal, aplikasi seluler native, peta seluruh laut Indonesia, klaim jumlah stok absolut.

## 9. Limitasi yang harus tampil di aplikasi

- Data tangkapan beresolusi wilayah dan bulanan; nilai zona hasil alokasi.
- Model dilatih pada rentang waktu terbatas; akurasi dilaporkan, bukan dijamin.
- Kelas kelimpahan bersifat relatif dan berbasis aturan.
- Hasil adalah alat bantu keputusan, bukan regulasi resmi.
- **Limitasi data oseanografi:**
  - Interpolasi spasial hanya berasal dari 6 titik stasiun (T1..T6).
  - Data Klorofil-a (chl) tidak tersedia di stasiun T4 dan T5 (nilai kosong/NULL).
  - Data Suhu Permukaan Laut (SST) dan Arus (uo, vo) baru tersedia mulai tanggal 2022-06-01.
  - Grid diinterpolasi dari 6 titik stasiun; hari setelah data terukur terakhir adalah prakiraan LSTM; akurasi dilaporkan, bukan dijamin.

## 10. Catatan keputusan terbuka dan migrasi arsitektur

> **PERHATIAN:** Perubahan arsitektur penyimpanan dan alur pipeline (Turso + Upstash + GitHub Actions) memerlukan persetujuan **Nazma** (pemilik `ml/`).

### Keputusan arsitektur dan pemodelan:
1. **Prakiraan oseanografi harian dengan LSTM [KEPUTUSAN, VALIDASI Nazma]:**
   Prakiraan oseanografi harian menggunakan model LSTM multi-horizon langsung (bukan rekursif) untuk 30 hari ke depan pada 6 stasiun oseanografi (chl dalam log, sst, uo, vo, sin/cos hari-dalam-tahun). Grid spasial harian diinterpolasi menggunakan IDW (uo dan vo diinterpolasi terpisah) untuk jendela waktu H-3..H+3.
2. **Pemetaan zona ke wilayah tangkapan (PRD 4.3; milik Devina dan Nazma):**
   Zona mana saja (Z-01..Z-06) yang menggunakan data tangkapan wilayah Karangantu dan mana yang menggunakan wilayah Lebak.
3. **Effort wilayah Lebak:**
   Nilai effort Lebak bernilai SAMA di 12 bulan dalam setahun (2020: 3086, 2021: 1498, ...). Angka ini kemungkinan adalah angka tahunan yang disalin per bulan. Sesuai kesepakatan, data diimpor apa adanya ke tabel observasi, diberi catatan di dokumen, dan **tidak boleh dipakai sebagai effort bulanan di logika apa pun**.
4. **Pemetaan spesies ke kelompok ikan:**
   Konfirmasi dari Devina diperlukan untuk pemetaan spesies saat validasi impor: Tongkol abu-abu + Tenggiri = `pelagis_besar`; Teri + Kembung = `pelagis_kecil`; Peperek + Kuniran = `demersal`. Pemetaan ini murni untuk validasi impor, bukan untuk kalkulasi model.
5. **Format berkas CSV di `data/raw/` untuk `ml/01_prepare`:**
   Format dan skema kolom CSV yang diekspor dari database untuk dibaca pipeline ML ditentukan oleh Nazma.

## 11. Tonggak

1. Data contract + pipeline ML menghasilkan JSON/GeoJSON (Nazma).
2. Marine Stock membaca output pipeline (Aqill).
3. Stock Prediction dan Download Data.
4. Auth, sesi, verifikasi email, Dashboard.
5. Uji akseptasi, About, polishing desain (Najla).

---
## 4.2. Fitur baru – Rentang waktu H‑3..H+3 & Prakiraan oseanografi harian

- **Rentang waktu**: pengguna dapat memilih 7 hari (H‑3, H‑2, H‑1, Hari ini, H+1, H+2, H+3) via kontrol UI di sidebar Marine Stock.
- **Label**: setiap hari menampilkan label **Terukur** (data observasi tersedia) atau **Prakiraan (LSTM)** (model LSTM) dengan kombinasi simbol dan teks.
- **Data terukur terakhir** ditampilkan di UI; bila lebih dari 7 hari dari hari ini, sistem menampilkan peringatan *stale*.
- **RMSE / MAE** model LSTM ditampilkan pada legenda dan pinbox untuk hari prakiraan.

> **Kriteria penerimaan tambahan**
- Semua 7 hari harus muncul dalam UI dengan label yang tepat.
- Nilai titik (SST, klorofil‑a, kecepatan arus) dihitung < 1 detik di klien.
- Tidak ada nilai negatif pada hasil interpolasi atau prakiraan.
- Pada hari *stale* UI menandai dengan warna peringatan dan teks.

---
