# terrasea-stock

WebGIS stok perikanan pesisir Banten. Baca `AGENTS.md` dan `docs/` sebelum mengubah kode.

## Menjalankan secara Lokal

```bash
npm install                        # menyalin Leaflet, Chart.js, dan font ke public/vendor
cp .env.example .env               # sesuaikan konfigurasi dan rahasia lokal
npm run migrate                    # jalankan migrasi database libSQL (001 dan 002)
npm run import-observations        # impor observasi nyata dari data/unprocessed data/
npm run seed-artifacts             # isi tabel artifacts dari data/processed/
npm run create-admin -- "Nama Admin" email@instansi.ac.id
npm run validate && npm test       # periksa skema kontrak dan seluruh unit test
npm run dev                        # jalankan server lokal (http://localhost:3000)
```

Tanpa `SMTP_HOST` (mode development), tautan verifikasi dicetak langsung di terminal.
Foto tim: taruh `aqill.jpg`, `devina.jpg`, `najla.jpg`, `nazma.jpg` (rasio 4:5) di `public/img/tim/`.

## Siklus Data dan Pipeline

1. **Observasi Mentah:** Diimpor dari berkas Excel lapangan (`npm run import-observations`) atau di-ingest bot berkala via endpoint `/api/ingest/*` ke database Turso.
2. **Ekspor untuk ML:** `npm run export-observations` mengekstrak data mentah ke `data/raw/*.csv`.
3. **Pipeline ML (Nazma):** Dijalankan via GitHub Actions atau lokal di `ml/` menghasilkan keluaran di `data/processed/`.
4. **Publikasi Data Olahan:** `npm run publish-artifacts` memvalidasi kontrak dan menyimpannya ke tabel `artifacts`.
5. **Penyajian Web:** Express membaca langsung dari tabel `artifacts` (dengan in-memory cache TTL 60 detik). Bila tabel kosong, otomatis fallback ke berkas `fixture_*`.

## Deployment Vercel

Aplikasi dirancang siap deploy di Vercel Hobby (serverless) dengan basis data cloud Turso (libSQL) dan Upstash Redis (rate limiting). Konfigurasi serverless berada di `vercel.json` (region `sin1`) dan entrypoint di `api/index.js`. Halaman HTML privat diisolasi di folder `views/` terlindungi middleware sesi.

