# Bot Pengunduh Data Oseanografi Copernicus Marine Service (CMEMS)
**Sistem WebGIS Terrasea-Stock — Pesisir Banten**

Bot ini mengunduh data harian klorofil-a, suhu permukaan laut (SST), dan arus laut secara otomatis dari Copernicus Marine Service (CMEMS) untuk 6 titik stasiun pengamatan di pesisir Banten.

---

## 1. Parameter & Dataset yang Digunakan

1. **Klorofil-a (Chl-a)**
   - **Dataset ID**: `cmems_mod_glo_bgc-pft_anfc_0.25deg_P1D-m`
   - **Variabel**: `chl` (mg/m³)

2. **Suhu Permukaan Laut (SST)**
   - **Dataset ID**: `cmems_mod_glo_phy-thetao_anfc_0.083deg_P1D-m`
   - **Variabel**: `thetao` (°C)

3. **Kecepatan & Arah Arus (SWV)**
   - **Dataset ID**: `cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m`
   - **Variabel**: `uo` (m/s), `vo` (m/s)

---

## 2. Lokasi 6 Titik Pengamatan

| Stasiun | Latitude (°N) | Longitude (°E) | Wilayah Perairan |
| :--- | :---: | :---: | :--- |
| **Titik 1** | `-7.2230` | `106.0994` | Banten Selatan |
| **Titik 2** | `-7.0236` | `105.2976` | Selat Sunda Selatan |
| **Titik 3** | `-6.6195` | `104.9594` | Ujung Kulon / Barat Daya |
| **Titik 4** | `-6.5007` | `105.6083` | Labuan / Pesisir Barat |
| **Titik 5** | `-5.9519` | `105.6736` | Selat Sunda Utara |
| **Titik 6** | `-5.7564` | `106.6378` | Teluk Banten / Karangantu |

### Segitiga Interpolasi:
- **Area Bawah Banten**: Segitiga (1, 2, 4) dan (2, 3, 4)
- **Area Atas Banten**: Segitiga (3, 4, 5) dan (4, 5, 6)

---

## 3. Konfigurasi Lingkungan (`.env`)

Pastikan variabel-variabel berikut ada di file `.env` di root proyek:

```env
# Akun Copernicus Marine Service
COPERNICUS_USERNAME=username_anda
COPERNICUS_PASSWORD=password_anda

# Konfigurasi Ingest Backend Web
APP_URL=http://localhost:3000
INGEST_API_KEY=tsk_e2d64dd50557d0432d36a6e86ffa10f9b46b28681ab5e40e

# Tanggal Awal Mulai Unduh (Default: 2026-10-29)
COPERNICUS_START_DATE=2026-10-29
```

---

## 4. Cara Menjalankan Bot

### A. Mode Offline (Lokal di Laptop/PC)

1. **Jalankan Sekali (One-shot)**
   Mengunduh semua data baru mulai dari tanggal terakhir yang tersimpan hingga hari ini, lalu otomatis keluar:
   ```bash
   .\.venv\Scripts\python.exe bot/copernicus_bot.py --mode once
   ```

2. **Jalankan Terus-Menerus di Latar Belakang (Daemon)**
   Bot akan tetap menyala dan memeriksa data baru setiap N jam (misalnya setiap 6 jam):
   ```bash
   .\.venv\Scripts\python.exe bot/copernicus_bot.py --mode daemon --interval 6
   ```

3. **Uji Coba Ekstraksi Tanpa Menyimpan (`--dry-run`)**
   ```bash
   .\.venv\Scripts\python.exe bot/copernicus_bot.py --mode once --dry-run
   ```

4. **Menentukan Rentang Tanggal Khusus Manual**
   ```bash
   .\.venv\Scripts\python.exe bot/copernicus_bot.py --mode once --start-date 2026-10-29 --end-date 2026-11-05
   ```

---

### B. Mode Online (Cloud / GitHub Actions)

Bot sudah terintegrasi dengan GitHub Actions di `.github/workflows/copernicus-bot.yml`.
Workflow ini akan berjalan otomatis setiap 12 jam di server GitHub tanpa perlu komputer lokal Anda menyala.

**Langkah aktivasi di GitHub:**
1. Buka repositori GitHub Anda -> **Settings** -> **Secrets and variables** -> **Actions**.
2. Tambahkan Repository Secrets:
   - `COPERNICUS_USERNAME` : Username Copernicus Anda
   - `COPERNICUS_PASSWORD` : Password Copernicus Anda
   - `APP_URL` : URL web produksi (mis. `https://terrasea-stock.vercel.app` atau URL server Anda)
   - `INGEST_API_KEY` : Kunci API Ingest bot
3. Workflow akan berjalan terjadwal secara otomatis atau dapat dipicu manual melalui tab **Actions** -> **Copernicus Ocean Ingest Bot** -> **Run workflow**.

---

## 5. Output Penyimpanan

1. **Database WebGIS Terrasea-Stock**:
   Data dikirim via `POST /api/ingest/ocean` dan langsung masuk ke tabel `obs_ocean` database libSQL/Turso.
2. **Cadangan Offline Lokal**:
   Tersimpan rapi di `data/raw/copernicus_ocean.csv` dengan kolom:
   `station_id, date, chl, sst, uo, vo`.

