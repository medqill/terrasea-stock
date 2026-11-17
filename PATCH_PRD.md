# Sisipan untuk docs/PRD.md (Fase 9, menunggu persetujuan tim)

## Bagian 4 (Keputusan sains): tambah butir 7
7. **Prakiraan oseanografi harian dengan LSTM [KEPUTUSAN, VALIDASI Nazma].** SST, klorofil-a, dan arus (uo, vo) di 6 titik stasiun
   diprakirakan harian dengan LSTM keluaran langsung (maksimum 30 hari) dan ansambel 5 seed. Split kronologis (latih <= 2024-12,
   uji 2025, holdout 2026), scaler hanya di data latih. Dibandingkan dengan baseline persistensi dan klimatologi musiman; hasil
   dilaporkan apa adanya. Grid harian diinterpolasi IDW. Ini terpisah dari model PLS bulanan untuk MSY/TAC.

## Bagian 5 (Ruang lingkup, Marine Stock): tambah
- **Rentang waktu H-3..H+3.** Tujuh pilihan (H-3, H-2, H-1, Hari ini, H+1, H+2, H+3), tiap pilihan menampilkan tanggal dan penanda
  "Terukur" atau "Prakiraan (LSTM)" (simbol + teks). Skala warna tetap untuk ketujuh hari. Klik peta di area grid membuka pinbox
  titik berisi SST, klorofil-a, dan arus hasil interpolasi bilinear di klien. Kelimpahan dan MSY/TAC tetap bulanan.

## Bagian 7 (Kriteria penerimaan): tambah
- Tujuh hari tampil dengan label Terukur/Prakiraan yang jelas, plus tanggal data terukur terakhir dan peringatan bila `stale`.
- Nilai titik tampil < 1 detik setelah grid hari itu termuat.
- RMSE/MAE uji prakiraan tampil di legenda dan pinbox titik untuk hari prakiraan.

## Bagian 8 (Non-goals): catatan
Prediksi > 1 bulan tetap non-goal. Prakiraan harian maksimum 30 hari hanya untuk menutup celah data terukur sampai H+3.

## Bagian 9 (Limitasi): tambah
- Grid diinterpolasi dari 6 titik stasiun; hari setelah data terukur terakhir adalah prakiraan LSTM; akurasi dilaporkan, bukan dijamin.
