# Sisipan untuk docs/ARCHITECTURE.md (Fase 9, menunggu persetujuan tim)

## Bagian 2 (Alur): tambah jalur harian
```
data mentah harian (obs_ocean, 6 titik)
   -> ml/05a_ocean_forecast.py  LSTM 30 hari, ansambel
   -> ml/05b_grids_idw.py       IDW 7 grid x 3 variabel + ocean_window
   -> validate -> publish (tabel artifacts) -> Express -> klien (lookup bilinear di klien)
```
Workflow harian `ocean-daily.yml` terpisah dari workflow bulanan PLS/zona.

## Bagian 4 (ADR): tambah baris
| 11 | Prakiraan oseanografi harian: LSTM offline di GitHub Actions, hasil sebagai artifact `dgrid:*` dan `ocean_window` | Konsisten dengan prinsip 1: web hanya menyajikan hasil; grid harian dibersihkan > 14 hari | Jika lama latih > 10 menit: latih mingguan |

## Bagian 5 (Data contract): tambah
`ocean_window` dan `dgrid:{var}:{YYYY-MM-DD}`: lihat `docs/PIPELINE_CONTRACT.md` bagian 5 dan 6.
Nilai titik yang diklik dihitung di KLIEN dari grid (lookup bilinear, bukan model): `public/js/gridlookup.js`.

## Bagian 6 (API): tambah / ubah
| Method | Path | Fungsi |
|---|---|---|
| GET | /ocean-window | artifact `ocean_window` |
| GET | /dgrids/:var?date=YYYY-MM-DD | grid harian (sst, chl, current) |
| PUT | /ingest/artifacts/:name | hanya nama pada daftar putih (kunci API, scope artifacts:write) |
| DELETE | /ingest/artifacts/:name | hanya `dgrid:*` (scope artifacts:write) |

`GET /ingest/artifacts/:name` dihapus (tidak terautentikasi).

## Bagian 8 (Layer peta): ubah butir 2
2. Grid interpolasi (SST/klorofil/arus), satu aktif, **per hari terpilih H-3..H+3**, skala warna tetap dari `ocean_window.scale`.
Butir lain tidak berubah (daratan tetap paling atas).
