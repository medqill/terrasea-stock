# ARCHITECTURE: terrasea-stock

Versi 0.2 | Pasangan dari `PRD.md`

> **PERHATIAN:** Perubahan arsitektur penyimpanan (Turso + Upstash + Vercel + GitHub Actions) memerlukan persetujuan **Nazma** (pemilik `ml/`).

## 1. Prinsip

1. **ML berjalan offline via GitHub Actions, web hanya menyajikan hasil.** Python menghitung PLS, klaster, kesesuaian habitat, interpolasi. Hasil pipeline disimpan di tabel `artifacts` pada database Turso (libSQL). Express hanya **MEMBACA** tabel `artifacts` (dengan fallback ke file `data/processed/fixture_*` bila baris belum tersedia). Alasan: model tidak perlu dilatih per request, hasil auditabel dan reprodusibel, server tetap ringan, dan disk serverless Vercel tidak permanen.
2. **Satu sumber kebenaran angka.** MSY, TAC, dan kelas kelimpahan dihitung **HANYA** di `ml/`. Frontend, route Express, route ingest, bot, maupun skrip impor **TIDAK BOLEH** menulis atau menghitung ulang nilai turunan tersebut.
3. **Data mentah dan data turunan dipisahkan.** Tabel observasi mentah (`obs_ocean`, `obs_catch`, `obs_catch_species`, `obs_effort`) hanya menyimpan observasi asli dari bot/impor. Kolom turunan (`bulan_sin`, `bulan_cos`, `log1p_trip`, lag, rolling, `fold_*`, `split_hindcast`, `catch_ton`, `catch_total6`, `Total semua alat`, `Current Speed`) **TIDAK disimpan** di database karena dihitung ulang oleh `ml/01_prepare`.
4. **Setiap keluaran membawa jejak:** `model_version`, `generated_at`, `data_period`.

---

## 2. Alur

```
[Bot Sensor / Skrip Impor XLSX]
   │
   │  (1) POST /api/ingest/* (Auth: Bearer API Key, scope observations:write, maks. 500 baris/batch)
   ▼
[Database Turso (libSQL)]
   ├── Tabel Observasi: obs_ocean, obs_catch, obs_catch_species, obs_effort, stations, regions
   │
   │  (2) GitHub Actions (Bulanan / Dispatch Manual):
   │      - Ekspor data mentah via GET /api/ingest/export -> data/raw/*.csv
   │      - Jalankan pipeline Python ml/ (01_prepare .. 06_export) tanpa mengubah kode ml/
   │      - Validasi kontrak bersama (contract.js / validate-processed.js)
   │      - Unggah hasil ke tabel artifacts via PUT /api/ingest/artifacts/:name
   │
   ├── Tabel Artifacts: zones, ecosystem, forecast:*, grid:*, abundance:*
   ├── Tabel Akun & Sesi: users, sessions, email_tokens, api_keys, ingest_log, download_log
   ▼
[Express di Vercel Serverless (sin1) / server.js lokal]
   ├── Rate Limit: Upstash Redis (sliding window) + fallback in-memory dev
   ├── Auth & Sesi: Sliding session 20 menit (Turso)
   ├── Membaca tabel artifacts (in-memory cache TTL 60s, fallback fixture lokal)
   ├── Menyajikan views/*.html (di luar public/ agar tidak bocor via CDN Vercel)
   ▼
[Browser Klien]
   └── public/ (Leaflet + Chart.js, aset statis CDN)
```

---

## 3. Struktur folder

```
terrasea-stock/
 |-- .github/workflows/
 |   |-- pipeline.yml         # GitHub Actions: export data, run ML, publish artifacts
 |-- api/
 |   |-- index.js             # Entrypoint serverless Vercel (export default app)
 |-- ml/                      # pipeline Python (requirements.txt, config.yaml) - JANGAN DIUBAH
 |   |-- 01_prepare.py ... 06_export.py
 |   |-- tests/
 |-- data/
 |   |-- raw/                 # data mentah CSV untuk ML (diabaikan git)
 |   |-- processed/           # output pipeline / fixtures cadangan (masuk git)
 |   |-- geo/                 # daratan Indonesia, garis pantai, terumbu, lamun
 |-- docs/                    # PRD, ARCHITECTURE, DESIGN_SYSTEM, PIPELINE_CONTRACT
 |-- views/                   # Halaman HTML (di luar public/ agar aman dari CDN Vercel)
 |   |-- index.html, marine-stock.html, stock-prediction.html, download.html, about.html, login.html, dashboard.html
 |-- public/                  # Aset statis murni yang dilayani publik
 |   |-- css/ (tokens.css, base.css, components.css, map.css)
 |   |-- js/  (api.js, map.js, charts.js, auth-ui.js, layout.js, mapkit.js)
 |   |-- vendor/              # Leaflet, Chart.js, font (self-host)
 |   |-- img/
 |-- scripts/
 |   |-- migrate.js           # Menjalankan migrasi SQL libSQL (npm run migrate)
 |   |-- import-observations.js # Impor xlsx data mentah ke tabel obs_*
 |   |-- export-observations.js # Ekspor tabel obs_* ke data/raw/*.csv untuk ML
 |   |-- seed-artifacts.js    # Muat data/processed/ ke tabel artifacts di Turso
 |   |-- publish-artifacts.js # PUT data/processed/ ke /api/ingest/artifacts/:name
 |   |-- validate-processed.js# Validasi skema output ML
 |   |-- create-admin.js      # Pembuatan akun admin (CLI)
 |   |-- create-api-key.js    # Pembuatan kunci API bot (CLI)
 |-- src/
 |   |-- auth.js              # scrypt, token, sesi
 |   |-- mail.js              # nodemailer (SMTP)
 |   |-- db.js                # libSQL client (@libsql/client) untuk Turso / local.db
 |   |-- migrate.js           # Runner migrasi schema_migrations
 |   |-- ratelimit.js         # Upstash Redis rate-limiter + fallback memori
 |   |-- contract.js          # Skema validasi kontrak bersama (ML & artifacts)
 |   |-- ingest-schema.js     # Validasi skema baris ingest data mentah
 |   |-- async-handler.js     # Wrapper async error handling Express 4
 |   |-- data.js              # Layer akses artifacts (DB + cache + fallback fixture)
 |   |-- migrations/
 |   |   |-- 001_initial.sql
 |   |   |-- 002_observations_artifacts.sql
 |   |-- routes/
 |   |   |-- auth.js, map.js, stock.js, download.js, admin.js
 |   |   |-- ingest.js        # Endpoint ingest data mentah bot & artifacts
 |   |-- middleware.js        # requireAuth, requireAdmin, requireApiKey, rate limit
 |   |-- excel.js             # penyusun .xlsx
 |   |-- app.js               # Express application factory
 |-- vercel.json              # Konfigurasi Vercel deployment (region sin1)
 |-- .env.example
 |-- .gitignore  package.json  package-lock.json  README.md  AGENTS.md
 |-- server.js                # Server lokal Node.js
```

---

## 4. Keputusan teknis (ADR ringkas)

| # | Keputusan | Alasan | Kapan ditinjau |
|---|---|---|---|
| 1 | Pipeline ML di Python, bukan Node | Ekosistem scikit-learn/geopandas, dipegang Nazma | Tidak berubah |
| 2 | Output ML disimpan di tabel `artifacts` | Disk Vercel bersifat ephemeral. Membaca tabel DB memungkinkan pembaruan tanpa redeploy | Jika artifacts > 10 MB per row: S3 / R2 |
| 3 | Database **Turso (libSQL)** menggantikan SQLite file lokal | SQLite file lokal hilang di container serverless Vercel. libSQL kompatibel dialek SQLite, koneksi HTTP/WebSocket, aman penulisan konkuren, latency rendah di AWS ap-southeast-1 | Jika skala > 100 rb pengguna aktif |
| 4 | Frontend vanilla JS + Leaflet + Chart.js, tanpa framework | Struktur proyek sudah begitu, bundle kecil, tanpa build step frontend | Jika state UI membengkak |
| 5 | Interpolasi dihitung offline (IDW) jadi grid JSON per bulan per variabel | Tidak membebani klien browser | Jika butuh resolusi sangat halus: tile raster |
| 6 | Basemap MapTiler Dataviz, key di `.env` dan dibatasi per domain | Sesuai skema desain | Kuota habis: fallback CARTO |
| 7 | Library dan font di-self-host | Tidak bergantung CDN pihak ketiga, stabil | - |
| 8 | **Upstash Redis** untuk rate limiting | Rate limiter in-memory tidak akurat di serverless karena instance multi-region dan ephemeral. Upstash REST API cepat dan stateless | Jika Redis self-hosted lebih murah |
| 9 | **API Ingest Bot khusus data mentah** | Bot sensor perlu input data secara periodik tanpa login cookie sesi. Diproteksi API key dengan scope | Jika butuh protokol streaming (MQTT/Kafka) |
| 10 | **GitHub Actions untuk pipeline ML** | ML Python tidak dapat berjalan langsung di Vercel serverless. GitHub Actions menyediakan lingkungan Ubuntu + Python gratis dan terjadwal | Jika butuh pelatihan harian intensif |
| 11 | **Folder `views/` di luar `public/`** | Vercel menyajikan seluruh folder `public/` sebagai aset publik via CDN tanpa melewati Express `requireAuth`. Pemindahan ke `views/` mencegah kebocoran halaman tertutup | Wajib di Vercel |

---

## 5. Data contract dan Skema Database

### A. Skema Database (Migrasi 002: Observasi, API Key, Artifacts)

```sql
CREATE TABLE regions(code TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE stations(id TEXT PRIMARY KEY, lon REAL NOT NULL, lat REAL NOT NULL);
CREATE TABLE obs_ocean(
  station_id TEXT NOT NULL REFERENCES stations(id), date TEXT NOT NULL,
  chl REAL, sst REAL, uo REAL, vo REAL,
  api_key_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(station_id, date)) WITHOUT ROWID;
CREATE TABLE obs_catch(
  region TEXT NOT NULL REFERENCES regions(code), month TEXT NOT NULL,
  fish_group TEXT NOT NULL CHECK (fish_group IN ('pelagis_besar','pelagis_kecil','demersal')),
  catch_kg REAL CHECK (catch_kg >= 0),
  api_key_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(region, month, fish_group)) WITHOUT ROWID;
CREATE TABLE obs_catch_species(
  region TEXT NOT NULL REFERENCES regions(code), month TEXT NOT NULL, species TEXT NOT NULL,
  catch_kg REAL CHECK (catch_kg >= 0),
  api_key_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(region, month, species)) WITHOUT ROWID;
CREATE TABLE obs_effort(
  region TEXT NOT NULL REFERENCES regions(code), month TEXT NOT NULL, gear TEXT NOT NULL,
  trips INTEGER CHECK (trips >= 0),
  api_key_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(region, month, gear)) WITHOUT ROWID;
CREATE TABLE api_keys(id INTEGER PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL,
  scopes TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT);
CREATE TABLE ingest_log(id INTEGER PRIMARY KEY, api_key_id INTEGER, endpoint TEXT NOT NULL,
  status INTEGER NOT NULL, rows INTEGER, detail TEXT, created_at TEXT NOT NULL);
CREATE TABLE artifacts(name TEXT PRIMARY KEY, month TEXT, content TEXT NOT NULL,
  model_version TEXT, generated_at TEXT, is_fixture INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
INSERT INTO regions VALUES ('karangantu','Karangantu'),('lebak','Lebak');
```

- **Satuan Tangkapan:** Tangkapan disimpan dalam **KG** (sesuai data mentah asli); ton dihitung saat dibaca untuk kalkulasi.
- **Kolom Turunan:** Kolom turunan yang dihitung oleh `ml/01_prepare` (`bulan_sin`, `bulan_cos`, `log1p_trip`, lag, rolling, `Total semua alat`, `Current Speed`, dll) **TIDAK disimpan di database**.

### B. Daftar Nama Artifact yang Diizinkan

- `zones`: GeoJSON feature collection poligon zona prioritas pesisir
- `ecosystem`: GeoJSON poligon terumbu karang dan lamun
- `forecast:Z-01` .. `forecast:Z-06`: Objek JSON metrik, deret hindcast/forecast, dan parameter bulanan
- `grid:sst:YYYY-MM`: Grid interpolasi SST
- `grid:chl:YYYY-MM`: Grid interpolasi Klorofil-a
- `grid:current:YYYY-MM`: Grid interpolasi Kecepatan dan arah arus
- `abundance:YYYY-MM`: Grid indeks kelimpahan relatif per kelompok ikan

### C. Keputusan Sains yang Belum Selesai (Wajib Dikonfirmasi)

1. **Alokasi Zona Karangantu vs Lebak:** Zona mana saja (Z-01..Z-06) yang memakai tangkapan Karangantu dan mana Lebak (milik Devina & Nazma).
2. **Effort Lebak:** Data 12 bulan bernilai sama per tahun. Diimpor apa adanya, diberi catatan di dokumen, dan **tidak dipakai sebagai effort bulanan di logika apa pun**.
3. **Pemetaan Spesies:** Tongkol abu-abu + Tenggiri = `pelagis_besar`; Teri + Kembung = `pelagis_kecil`; Peperek + Kuniran = `demersal` (konfirmasi Devina; hanya untuk validasi saat impor).
4. **Format CSV Ekspor untuk ML:** Ditentukan oleh Nazma sebelum otomatisasi pipeline berjalan penuh.

---

## 6. API

Semua rute disajikan di bawah prefix `/api`.

| Method | Path | Auth / Proteksi | Fungsi |
|---|---|---|---|
| POST | /auth/register | Publik (Rate limit: 5/jam) | Buat akun pending, kirim email verifikasi |
| GET | /auth/verify?token= | Publik | Aktivasi akun via token hash sekali pakai |
| POST | /auth/login | Publik (Rate limit: 10/15m) | Login sesi sliding 20 menit |
| POST | /auth/logout | Sesi aktif | Hapus sesi aktif |
| GET | /auth/me | Sesi aktif | Heartbeat klien & info pengguna |
| GET | /config | Sesi aktif | Kunci & map ID basemap MapTiler |
| GET | /meta | Sesi aktif | Model version, generated at, bulan aktif |
| GET | /zones?month= | Sesi aktif | zones.geojson dari tabel artifacts |
| GET | /ecosystem | Sesi aktif | ecosystem.geojson dari tabel artifacts |
| GET | /land | Sesi aktif | Layer daratan GeoJSON (data/geo/land.geojson) |
| GET | /grids/:var?month= | Sesi aktif | Grid interpolasi dari artifacts |
| GET | /point?lat&lng&month= | Sesi aktif | Lookup nilai titik dalam zona |
| GET | /forecast/:zoneId | Sesi aktif | Forecast & hindcast dari artifacts |
| GET | /download?type&from&to&group= | Sesi aktif (Rate limit: 20/10m) | Unduh file Excel laporan |
| GET | /admin/stats | Admin | Statistik sistem, model aktif, dan antrean verifikasi |
| GET | /admin/users | Admin | Manajemen akun: daftar seluruh akun terdaftar dan terakhir masuk |
| POST | /admin/users/:id/activate | Admin | Aktifkan akun pengguna (manual / pemulihan) |
| POST | /admin/users/:id/deactivate | Admin | Nonaktifkan akun pengguna dan cabut seluruh sesi aktif |
| DELETE | /admin/users/:id | Admin | Hapus akun pengguna (antrean kedaluwarsa / akun tidak valid) |
| GET | /admin/downloads | Admin | Riwayat unduhan dengan filter jenis/periode & ringkasan unduhan terbanyak |
| POST | /admin/api-keys | Admin | Buat kunci API bot baru (kunci mentah muncul sekali) |
| GET | /admin/api-keys | Admin | Daftar kunci API (tanpa menampilkan hash) |
| DELETE | /admin/api-keys/:id | Admin | Cabut (revoke) kunci API |
| GET | /admin/monthly-records | Admin | Status kelengkapan pencatatan bulanan tangkapan dan trip |
| POST | /admin/monthly-records | Admin | Catat tangkapan bulanan (3 kelompok ikan) & trip ke obs_catch & obs_effort |
| POST | /ingest/ocean | API Key (`observations:write`) | Ingest data observasi oseanografi (maks. 500 baris) |
| POST | /ingest/catch | API Key (`observations:write`) | Ingest data tangkapan kelompok ikan (maks. 500 baris) |
| POST | /ingest/catch-species | API Key (`observations:write`) | Ingest data tangkapan spesies (maks. 500 baris) |
| POST | /ingest/effort | API Key (`observations:write`) | Ingest data upaya penangkapan (trip) (maks. 500 baris) |
| GET | /ingest/export | API Key (`observations:read`) | Ekspor data observasi mentah berhalaman (limit & cursor) |
| PUT | /ingest/artifacts/:name | API Key (`artifacts:write`) | Publikasi data olahan hasil pipeline ML ke tabel artifacts |

---

## 7. Keamanan dan Kunci API Bot

1. **Kunci API Bot:**
   - Format: `tsk_<32-byte-hex>`.
   - Hanya hash sha256 yang disimpan di tabel `api_keys`.
   - Header request: `Authorization: Bearer tsk_...`.
   - Diperiksa oleh middleware `requireApiKey(scope)`. Jika kunci tak dikenal atau `revoked_at` terisi -> 401; scope tidak memadai -> 403.
   - Kolom `last_used_at` diperbarui otomatis saat permintaan berhasil.
   - Setiap permintaan ingest dicatat di tabel `ingest_log` (tanpa mencatat nilai kunci).
2. **Sesi Web:**
   - Cookie `HttpOnly`, `SameSite=Lax`, `Secure` (di produksi).
   - Sliding session 20 menit diperiksa di server (`last_activity`).
   - Token verifikasi email acak 32-byte, disimpan sebagai hash sha256, kedaluwarsa 24 jam, sekali pakai.
3. **Rate Limiting (Upstash Redis):**
   - Ingest: 60 request/menit per API Key + 120 request/menit per IP.
   - Login: 10 percobaan / 15 menit per IP.
   - Register: 5 percobaan / 1 jam per IP.
   - Download: 20 unduhan / 10 menit per IP.
   - Fail-open: Bila Upstash tidak dapat dijangkau di runtime, request tetap diizinkan dan error dicatat ke console tanpa membocorkan kredensial.
4. **Isolasi Aset Vercel:**
   - File template halaman HTML ditaruh di `views/` dan hanya disajikan melalui route Express dengan middleware `requireAuth`. Folder `public/` hanya berisi aset statis murni (CSS, JS, gambar, vendor).

---

## 8. Layer peta (urutan z-index, dari bawah)

1. Basemap Dataviz
2. Grid interpolasi (SST/klorofil/arus), satu aktif
3. Poligon terumbu dan lamun (muncul sesuai permintaan)
4. Poligon zona (interaktif)
5. Marker titik pengguna
6. **Daratan Indonesia (paling atas, non-interaktif)**

---

## 9. Pengujian

- `ml/tests`: tidak ada zona >350 ha, semua menyentuh pantai, tidak ada prediksi <0, scaler fit hanya di data latih.
- `contract.js` / `validate-processed.js`: validasi integritas skema JSON/GeoJSON sebelum diunggah ke artifacts.
- Uji API Ingest: tanpa kunci (401), scope salah (403), kunci dicabut (401), batch tidak valid menolak seluruh transaksi (0 baris tersimpan), idempotensi upsert.
- Uji Sesi & Keamanan: akses tanpa sesi (401 & redirect), idle timeout 20 menit, rate limit Upstash, isolasi `views/`.

---
## 5. Data contract – Artifact baru

### ocean_window
```json
{
  "reference_date": "YYYY-MM-DD",
  "data_through": "YYYY-MM-DD",
  "stale": true|false,
  "days": [
    {"date":"YYYY-MM-DD","offset":-3,"kind":"observed|forecast","horizon_days":null},
    ...
    {"date":"YYYY-MM-DD","offset":3,"kind":"observed|forecast","horizon_days":3}
  ],
  "scale": {
    "sst": {"vmin":0,"vmax":30,"unit":"°C"},
    "chl": {"vmin":0,"vmax":5,"unit":"mg/m³"},
    "current": {"vmin":0,"vmax":2,"unit":"m/s"}
  },
  "metrics": [
    {"var":"sst","horizon_days":1,"rmse":0.5,"mae":0.3,"baseline_persistence_rmse":0.6,"baseline_climatology_rmse":0.55},
    ...
  ],
  "idw": {"power":2,"max_distance_km":150,"loocv":{"sst":{"rmse":0.4},"chl":{"rmse":0.2},"current":{"rmse":0.3}}},
  "model_version": "vX.Y.Z",
  "generated_at": "2026-11-09T13:45:00Z"
}
```

### dgrid:{var}:{YYYY-MM-DD}
```json
{
  "var": "sst|chl|current",
  "unit": "°C|mg/m³|m/s",
  "date": "YYYY-MM-DD",
  "kind": "observed|forecast",
  "bbox": [west,south,east,north],
  "nx": 100,
  "ny": 80,
  "values": [...],
  "vmin": 0,
  "vmax": 30,
  "model_version": "vX.Y.Z",
  "generated_at": "2026-11-09T13:45:00Z"
}
```
---
