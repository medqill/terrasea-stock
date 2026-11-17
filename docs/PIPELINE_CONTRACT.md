# Kontrak Alur Data dan Otomasi Pipeline ML

Dokumen ini mendefinisikan kontrak data, alur kerja otomasi, dan batasan antara lapisan basis data observasi mentah (Turso), pipeline pemodelan machine learning (Python di `ml/`), dan aplikasi WebGIS (Express di Vercel).

---

## 1. Arsitektur Alur Data (End-to-End)

```
[Sumber Data Mentah: Stasiun BMKG / Pelabuhan]
                 │
                 ▼
      [API Ingest Bot / Skrip Impor]
  (POST /api/ingest/* dengan Bearer API Key)
                 │
                 ▼
   ┌───────────────────────────────┐
   │     Database Cloud Turso      │
   │  (obs_ocean, obs_catch, dll)  │
   └──────────────┬────────────────┘
                  │
                  ▼ (Trigger: GitHub Actions cron tgl 1 / manual dispatch)
   ┌───────────────────────────────┐
   │  npm run export-observations  │
   │       -> data/raw/*.csv       │
   └──────────────┬────────────────┘
                  │
                  ▼
   ┌───────────────────────────────┐
   │       Pipeline ML Python      │
   │   (ml/01_prepare ... 06_export)│
   │    -> data/processed/*.json   │
   └──────────────┬────────────────┘
                  │
                  ▼
   ┌───────────────────────────────┐
   │       npm run validate        │ (Pemeriksaan Skema & Batas Keras)
   └──────────────┬────────────────┘
                  │
                  ▼
   ┌───────────────────────────────┐
   │   npm run publish-artifacts   │
   │   -> Tabel artifacts Turso    │
   └──────────────┬────────────────┘
                  │
                  ▼
     [Aplikasi WebGIS di Vercel]
(GET /api/zones, /forecast, /grids membaca tabel artifacts)
```

---

## 2. Kontrak Data Mentah (Ekspor dari DB ke `data/raw/`)

Dihasilkan oleh `scripts/export-observations.js` (`npm run export-observations`). Format berkas berupa CSV standar UTF-8 tanpa kolom turunan (kolom turunan seperti `Current Speed`, `bulan_sin`, `bulan_cos`, lag, dan rolling dihitung di `ml/01_prepare`):

### A. `data/raw/observations_ocean.csv`
| Kolom | Tipe | Rentang Nilai | Keterangan |
|---|---|---|---|
| `station_id` | TEXT | T1 s.d. T6 | ID stasiun oseanografi |
| `date` | TEXT | `YYYY-MM-DD` | Tanggal pengamatan |
| `chl` | REAL / NULL | 0.0 s.d. 50.0 | Klorofil-a (mg/m³) |
| `sst` | REAL / NULL | 15.0 s.d. 35.0 | Suhu permukaan laut (°C) |
| `uo` | REAL / NULL | -5.0 s.d. 5.0 | Komponen arus zonal timur-barat (m/s) |
| `vo` | REAL / NULL | -5.0 s.d. 5.0 | Komponen arus meridional utara-selatan (m/s) |

### B. `data/raw/observations_catch.csv`
| Kolom | Tipe | Nilai | Keterangan |
|---|---|---|---|
| `region` | TEXT | `karangantu`, `lebak` | Wilayah pelabuhan pendaratan |
| `month` | TEXT | `YYYY-MM` | Periode bulan tangkapan |
| `fish_group` | TEXT | `pelagis_besar`, `pelagis_kecil`, `demersal` | Kelompok komoditas ikan |
| `catch_kg` | REAL | >= 0 | Total tangkapan dalam kilogram |

### C. `data/raw/observations_catch_species.csv`
| Kolom | Tipe | Format | Keterangan |
|---|---|---|---|
| `region` | TEXT | `karangantu`, `lebak` | Wilayah pelabuhan |
| `month` | TEXT | `YYYY-MM` | Periode bulan tangkapan |
| `species` | TEXT | slug lowercase (mis. `tongkol_abu_abu`, `tenggiri`) | Spesies ikan |
| `catch_kg` | REAL / NULL | >= 0 | Tangkapan dalam kilogram |

### D. `data/raw/observations_effort.csv`
| Kolom | Tipe | Format | Keterangan |
|---|---|---|---|
| `region` | TEXT | `karangantu`, `lebak` | Wilayah pelabuhan |
| `month` | TEXT | `YYYY-MM` | Periode bulan |
| `gear` | TEXT | slug lowercase (mis. `purse_seine`, `payang`) | Jenis alat tangkap |
| `trips` | INTEGER / NULL | >= 0 | Jumlah trip penangkapan |

---

## 3. Kontrak Data Olahan (`data/processed/` -> Tabel `artifacts`)

Divalidasi oleh `src/contract.js` (`npm run validate` dan `scripts/publish-artifacts.js`):

1. **`zones` (`zones.geojson`)**:
   - `features`: Array berisi 5 s.d. 7 fitur zona (`Z-01` s.d. `Z-06`).
   - Setiap fitur wajib memiliki properti:
     - `area_ha <= 350`
     - `touches_coast === true`
     - `msy` & `tac`: objek nilai >= 0 untuk `pelagis_besar`, `pelagis_kecil`, `demersal`, dan `total`.
     - `abundance`: `high`, `mid`, atau `low` untuk setiap kelompok ikan.
     - `model_version`, `generated_at`, `month`, `season`.
2. **`ecosystem` (`ecosystem.geojson`)**:
   - Poligon habitat ekosistem dengan `properties.type` bernilai `'coral'` atau `'seagrass'`.
3. **`forecast:Z-xx` (`forecast_Z-xx.json`)**:
   - `metrics`: wajib memuat `rmse`, `mae`, `n_test`, dan `n_components`.
   - `series`: daftar data bulanan bertipe `hindcast` atau `forecast` (nilai tidak boleh negatif, minimal ada satu baris `forecast`).
4. **`grid:<var>:YYYY-MM` (`grids/<var>_YYYY-MM.json`)**:
   - Variabel: `sst`, `chl`, `current`.
   - Panjang array `values` wajib persis `nx * ny`.
   - Memiliki `bbox`, `unit`, `vmin`, `vmax`.
5. **`abundance:YYYY-MM` (`grids/abundance_YYYY-MM.json`)**:
   - Array kelimpahan untuk setiap kelompok ikan berukuran persis `nx * ny`.

---

## 4. Alur Kerja GitHub Actions (`.github/workflows/pipeline.yml`)

- **Jadwal Eksekusi:** Terjadwal otomatis tanggal 1 setiap bulan pukul 02:00 UTC (09:00 WIB), atau dapat dipicu sewaktu-waktu melalui menu **Actions -> Run workflow** di GitHub.
- **Rahasia yang Dibutuhkan:**
  - `TURSO_DATABASE_URL`: URL basis data cloud Turso (`libsql://...`).
  - `TURSO_AUTH_TOKEN`: Token autentikasi basis data Turso.
- **Urutan Langkah:**
  1. Ekspor data mentah: `npm run export-observations`
  2. Eksekusi pipeline ML: `python ml/06_export.py` (milik Nazma)
  3. Validasi keluaran: `npm run validate`
  4. Publikasi ke basis data: `npm run publish-artifacts`

---

## 5. Cara Menjalankan Manual di Lingkungan Lokal

Untuk pengembang yang ingin memperbarui data olahan secara manual:

```powershell
# 1. Pastikan dependensi terpasang
npm install
cd ml; pip install -r requirements.txt; cd ..

# 2. Ekspor data observasi dari basis data lokal
npm run export-observations

# 3. Jalankan pipeline olahan ML (jika skrip Python tersedia)
cd ml; python 06_export.py; cd ..

# 4. Validasi hasil keluaran
npm run validate

# 5. Publikasikan ke tabel artifacts di database
npm run publish-artifacts
```

# PIPELINE_CONTRACT: prakiraan oseanografi harian (Fase 9)

Pasangan dari `PRD.md` dan `ARCHITECTURE.md`. Pemilik `ml/`: Nazma.

## 1. Alur harian (`.github/workflows/ocean-daily.yml`, 05.00 WIB)
`export-observations` -> `ml/05a_ocean_forecast.py` -> `ml/05b_grids_idw.py` -> `npm run validate` -> `npm run publish-artifacts`.
Workflow bulanan (PLS/zona) tetap terpisah (`pipeline.yml`).

## 2. Masukan (`data/raw/`)
- `observations_ocean.csv`: `station_id,date,chl,sst,uo,vo` (data final 6 titik).
- `stations.csv`: `station_id,lon,lat` (BARU, ditulis `scripts/export-observations.js`).
- `data/geo/land.geojson` (atau `fixture_land.geojson`) untuk menandai sel darat.

## 3. Definisi
- `reference_date`: hari ini zona waktu Asia/Jakarta.
- `data_through`: tanggal terakhir saat chl, sst, uo, vo terisi di SEMUA titik (asumsi; konfirmasi Nazma).
- `stale`: true bila `reference_date - data_through > 7` hari.
- `horizon_max = (reference_date + 3) - data_through`; bila > 30, 05a berhenti dengan galat.
- speed = sqrt(uo^2 + vo^2). uo dan vo diinterpolasi terpisah; arah TIDAK diinterpolasi sebagai sudut.
- Arah arus = arah TUJUAN, derajat dari utara searah jarum jam (sama dengan `windrose.js`).

## 4. `data/processed/ocean_forecast_stations.json` (perantara, tidak dipublikasikan)
```
{ model_version, generated_at, reference_date, data_through, stale, horizon_max, horizon_days: 30,
  stations: { T1: { dates: [30 tanggal], sst, sst_std, chl, chl_std, uo, uo_std, vo, vo_std, speed, speed_std } } }
```
Laporan evaluasi: `ml/reports/ocean_forecast_metrics.json` (test 2025, holdout 2026, per titik dan agregat,
RMSE/MAE vs baseline persistensi dan klimatologi, `beats_baselines`, `needs_decision`).

## 5. Artifact `dgrid:{var}:{YYYY-MM-DD}` (var: sst | chl | current)
`{ var, unit, date, kind, bbox, nx, ny, values, vmin, vmax, model_version, generated_at }`; untuk `current` tambah `uo` dan `vo`
(panjang nx*ny; `values` = kecepatan). File: `data/processed/dgrid_{var}_{date}.json`.
- `bbox` = [barat, selatan, timur, utara]. Baris dimulai dari barat laut. `null` = darat atau di luar jangkauan.
- **Nilai berada di PUSAT sel** (konvensi yang sama dengan `mapkit.gridOverlay` dan `gridlookup.js`).
- Bulatkan 3 desimal. chl dan kecepatan tidak boleh negatif.

## 6. Artifact `ocean_window`
```
{ reference_date, data_through, stale,
  days: [{ date, offset (-3..3), kind: observed|forecast, horizon_days (null bila observed) }] x 7,
  scale: { sst:{vmin,vmax,unit}, chl:{...}, current:{...} },     // persentil 2 dan 98 data terukur historis, TETAP 7 hari
  metrics: [{ var, horizon_days, rmse, mae, baseline_persistence_rmse, baseline_climatology_rmse }],  // galat UJI LSTM
  idw: { power, max_distance_km, loocv: { sst:{rmse}, chl:{rmse}, current:{rmse} } },
  model_version, generated_at }
```
Aturan konsistensi (diperiksa `src/contract.js`): `date = reference_date + offset`; `kind = observed` iff `date <= data_through`;
`horizon_days = date - data_through` untuk forecast; ketujuh hari x tiga variabel harus punya `dgrid` yang diterbitkan bersamaan.

## 7. Publikasi dan pembersihan
- `PUT /api/ingest/artifacts/:name` hanya menerima nama pada daftar putih (`isKnownArtifactName`).
- `DELETE /api/ingest/artifacts/:name` hanya untuk `dgrid:*` (scope `artifacts:write`).
- `publish-artifacts` menghapus `dgrid:*` yang tanggalnya > 14 hari (tanggal dari nama artifact).
- Pembacaan klien: `GET /api/ocean-window`, `GET /api/dgrids/:var?date=YYYY-MM-DD` (di balik `requireAuth`).
  `GET /api/ingest/artifacts/:name` dihapus.

## 8. Yang masih harus dikonfirmasi Nazma
1. Definisi `data_through` (semua titik lengkap) dan interpolasi celah <= 2 hari.
2. Lama pelatihan di runner GitHub (> 10 menit: latih mingguan, inferensi harian).
3. Kode IDW dari Colab untuk `ml/05b_grids_idw.py` (belum ditulis).