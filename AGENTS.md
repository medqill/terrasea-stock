# AGENTS.md: terrasea-stock

WebGIS stok perikanan pesisir Banten. Baca file ini penuh sebelum mengubah kode apa pun. (Pengguna Claude Code: salin sebagai `CLAUDE.md` atau buat `CLAUDE.md` berisi `@AGENTS.md`.)

## Wajib dibaca sebelum mengerjakan fitur

1. `docs/PRD.md` : apa dan mengapa, kriteria penerimaan, limitasi
2. `docs/ARCHITECTURE.md` : alur data, data contract, API, keamanan
3. `docs/DESIGN_SYSTEM.md` : token, tipografi, komponen, larangan

Jika permintaan bertentangan dengan dokumen itu, **berhenti dan tanyakan**. Jangan memilih diam-diam.

> **CATATAN PENTING:** Perubahan arsitektur penyimpanan (Turso + Upstash + Vercel + GitHub Actions) memerlukan persetujuan **Nazma** (pemilik `ml/`).

### Keputusan terbuka (dilarang menebak):
1. Zona mana (Z-01..Z-06) memakai tangkapan Karangantu dan mana Lebak (milik Devina & Nazma).
2. Effort Lebak sama di 12 bulan: diimpor apa adanya, jangan dipakai sebagai effort bulanan di logika apa pun.
3. Pemetaan spesies ke kelompok (konfirmasi Devina: Tongkol abu-abu + Tenggiri = pelagis besar; Teri + Kembung = pelagis kecil; Peperek + Kuniran = demersal).
4. Format CSV di `data/raw/` yang dibaca `ml/01_prepare` ditentukan oleh Nazma.

## Stack

Node 22 LTS (Express) + Turso (libSQL lewat `@libsql/client`) + Upstash Redis (`@upstash/ratelimit`), frontend vanilla JS + Leaflet + Chart.js (tanpa framework, tanpa bundler), pipeline ML Python (scikit-learn, pandas, geopandas) di `ml/` via GitHub Actions, deployment Vercel Hobby.

## Perintah

```bash
npm install
npm run dev                  # server lokal (node --watch server.js)
npm run migrate              # scripts/migrate.js (menjalankan migrasi SQL libSQL)
npm run import-observations  # scripts/import-observations.js (impor data mentah ke tabel obs)
npm run seed-artifacts       # scripts/seed-artifacts.js (isi tabel artifacts dari data/processed)
npm run validate             # scripts/validate-processed.js (skema output ML)
npm test                     # node --test test/ (database file:data/local.db sementara)
cd ml && pip install -r requirements.txt && python 06_export.py   # regenerasi output
```

## Aturan keras

**Data dan ML**
- Jangan pernah menghitung MSY, TAC, atau kelas kelimpahan di frontend, route Express, route ingest, bot, atau skrip impor. Hanya baca tabel `artifacts` (sumber: pipeline ml/).
- Jangan melatih atau menjalankan model di dalam request handler.
- Scaler di-fit **hanya** pada data latih. Split bersifat kronologis, tidak diacak.
- Prediksi tidak boleh negatif (clip ke 0).
- Zona maksimal 350 ha dan harus menyentuh garis pantai. Jangan ubah batas ini tanpa persetujuan.
- Setiap keluaran ML wajib membawa `model_version`, `generated_at`.
- Jangan mengarang data contoh yang terlihat nyata. Jika data belum ada di tabel `artifacts`, jatuh ke fixture berawalan `fixture_` dan tampilkan penanda di UI.

**Jujur di UI**
- Grafik prediksi selalu menampilkan RMSE dan MAE, dan label terpisah "Hindcast" vs "Forecast".
- Nilai MSY/TAC zona diberi keterangan "alokasi", kelas kelimpahan diberi keterangan "indeks berbasis aturan".
- Keterangan sumber pada legenda dan pinbox: "Interpolasi dari 6 titik stasiun".

**Keamanan**
- Rahasia hanya di `.env`. Jangan commit `.env`, `API_*.txt`, atau file kredensial lain. JANGAN membaca, mencetak, menyalin, atau me-commit isi file rahasia.
- Gunakan nilai kosong/placeholder (`xxxx`) untuk rahasia. Bila suatu perintah butuh kredensial asli (migrate, seed, impor ke Turso), tulis perintahnya dan minta user menjalankannya.
- Pengujian agen HANYA dengan `file:data/local.db`. Jangan menyambung ke Turso atau Upstash saat pengujian lokal/otomatis.
- Semua route selain Landing, aset statis (`public/`), dan endpoint publik (`/api/auth/*`) wajib `requireAuth`. Route ingest bot diproteksi dengan `requireApiKey(scope)`.
- Sesi idle 20 menit divalidasi di server.
- Token verifikasi email disimpan sebagai hash, kedaluwarsa 24 jam, sekali pakai.
- Query SQL hanya dengan parameter (prepared statement / parameterized query).
- Halaman HTML tertutup berada di `views/` (di luar `public/`) agar tidak disajikan langsung oleh CDN Vercel tanpa melewati autentikasi.

**Frontend dan desain**
- Gunakan token CSS dari `public/css/tokens.css`. Dilarang hex langsung di komponen.
- Status kelimpahan = simbol + warna (▲ hijau, = kuning, ▼ merah), tidak boleh warna saja.
- Urutan layer peta sesuai ARCHITECTURE bagian 8: daratan paling atas, zona di bawahnya.
- Dilarang: emoji sebagai ikon, glassmorphism, gradien ungu, font Inter/Roboto/Arial untuk tampilan, teks placeholder, warna pelangi untuk data.
- Semua teks UI dalam bahasa Indonesia, istilah teknis sesuai glosarium PRD (MSY, TAC, hindcasting).
- Library dan font di-self-host di `public/vendor/`.

## Konvensi

- File dan folder `kebab-case`, variabel JS `camelCase`, kolom DB dan JSON `snake_case`.
- Satu route file per domain di `src/routes/`.
- Komentar menjelaskan *mengapa*, bukan *apa*. Pesan commit bahasa Indonesia, gaya imperatif ("Tambah filter periode").
- Semua endpoint baru ditulis di tabel API pada ARCHITECTURE.md di commit yang sama.

## Definition of done (tiap fitur)

1. Memenuhi kriteria penerimaan terkait di PRD bagian 7.
2. `npm run validate` dan `npm test` lulus.
3. Diperiksa pada lebar 360, 768, 1280 px.
4. Navigasi keyboard dan kontras diperiksa.
5. Tidak ada `console.error`, tidak ada hex/placeholder yang tersisa.
6. Dokumen terkait diperbarui bila kontrak atau perilaku berubah.

## Jangan sentuh tanpa bertanya

- `data/raw/` dan `data/processed/` (hasil pipeline, regenerasi lewat `ml/`)
- Konfigurasi MSY/TAC (`ml/config.yaml`: faktor TAC, ambang kelimpahan)
- Skema tabel SQLite yang sudah dipakai (buat migrasi baru)
- Teks footer, nama tim, dan peran di About

## Cara bekerja

Kerjakan satu page atau satu endpoint per tugas. Sebelum menulis kode, sebutkan dokumen dan bagian yang menjadi acuan. Setelah selesai, laporkan apa yang diubah, apa yang belum diuji, dan asumsi yang diambil.
