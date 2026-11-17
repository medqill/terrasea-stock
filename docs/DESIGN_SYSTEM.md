# DESIGN SYSTEM: terrasea-stock

Versi 0.1 | Pemilik: Najla (Design Graphic) | Pasangan dari `PRD.md`

## 1. Konsep visual

**"Peta laut dan laporan oseanografi."** Rasa visualnya tenang, presisi, ilmiah: tinta biru-laut gelap di atas kertas pasir, aksen tembaga seperti kuningan instrumen navigasi. Motif khas: garis kontur batimetri, tick koordinat di tepi panel, skala batang. Semua ini mengganti dekorasi generik ala template SaaS.

## 2. Token warna (`public/css/tokens.css`)

Palet inti (dari tim):

| Token | Hex | Peran |
|---|---|---|
| `--ink-deep` | #10232A | latar utama gelap, header, sidebar |
| `--slate` | #3D4D55 | permukaan sekunder, garis, kartu di mode gelap |
| `--taupe` | #A79E93 | teks sekunder di atas gelap, ikon nonaktif |
| `--sand` | #D3C3B9 | latar section terang, teks utama di atas gelap |
| `--copper` | #B58863 | aksen, tombol utama, tautan, fokus |
| `--black` | #161616 | teks di atas permukaan terang |

Token semantik (pakai ini di komponen, **jangan hex langsung**):

```css
:root {
  --bg: var(--ink-deep);
  --surface: #17323B;            /* lapis di atas bg */
  --surface-2: var(--slate);
  --text: var(--sand);
  --text-muted: var(--taupe);
  --accent: var(--copper);
  --accent-hover: #C99A74;
  --line: rgba(211,195,185,.18);
  --paper: var(--sand);          /* section terang */
  --paper-text: var(--black);

  /* status kelimpahan (diuji di atas --surface) */
  --abund-high: #7DB88A;   /* ▲ sangat berlimpah */
  --abund-mid:  #E0B84A;   /* = berlimpah */
  --abund-low:  #D9695E;   /* ▼ kurang berlimpah */

  --focus: 2px solid var(--copper);
}
```

Warna status ditambahkan karena palet inti tidak memiliki hijau/kuning/merah. Nilainya dipilih bernada hangat-teredam agar serasi dengan palet earthy dan tetap terbaca di atas peta gelap. Cek ulang kontras >= 4,5:1 setelah dipasang.

**Aturan:** status kelimpahan selalu memakai simbol (▲ = ▼) **dan** warna, tidak boleh warna saja.

## 3. Skala warna peta (interpolasi)

Semua sekuensial, gelap = rendah, terang/hangat = tinggi, tidak memakai pelangi.

| Variabel | Ramp (rendah ke tinggi) |
|---|---|
| SST | #2E4A62, #6F8A93, #A79E93, #B58863, #E0A06A |
| Klorofil-a | #10232A, #2F6F6A, #8FBF9F, #E3E39A |
| Kecepatan arus | #3D4D55, #5E8B99, #8FC3CF, #D3C3B9 |

Legenda: batang gradasi kontinu, label nilai min/max/tengah, satuan (°C, mg/m³, m/s) dan bulan data. Opasitas grid 0,75 supaya garis pantai tetap terlihat.

## 4. Tipografi (self-host)

| Peran | Font | Catatan |
|---|---|---|
| Judul | **Fraunces** (serif, opsi variabel) | karakter editorial seperti laporan ilmiah |
| Isi / UI | **IBM Plex Sans** | netral, terbaca di ukuran kecil |
| Angka data, koordinat, label | **IBM Plex Mono** | `font-variant-numeric: tabular-nums` |

Skala: 12, 14, 16, 20, 28, 40, 56 px. Isi 16 px, tinggi baris 1,6. Judul `letter-spacing: -0.01em`. Label kecil kapital 12 px dengan `letter-spacing: .08em`.

## 5. Jarak, bentuk, bayangan

- Jarak basis 4 px: 4, 8, 12, 16, 24, 32, 48, 80.
- Radius kecil: 2 px untuk panel/kartu, 999 px hanya untuk chip status. Hindari sudut sangat bulat.
- Tanpa glassmorphism dan tanpa bayangan lembut besar. Pemisah memakai garis tipis `--line` (kesan panel instrumen).
- Pola kontur SVG sebagai tekstur latar hero dan footer, opasitas <= 8%.

## 6. Komponen

- **Header:** lengket, `--bg`, nama page huruf kapital kecil, tombol Login berupa outline tembaga. Page aktif ditandai garis bawah tembaga 2 px.
- **Tombol:** utama = isi tembaga + teks `--black`; sekunder = outline `--line`; fokus selalu terlihat.
- **Sidebar peta:** lebar 320 px, bisa dilipat ke ikon, gesekan buka-tutup 200 ms. Saat zona terkunci tampil tombol silang dan label "Zona Z-03 terkunci".
- **Pinbox zona:** judul zona (Fraunces), baris MSY dan TAC (Mono, satuan ton/bulan), tiga baris kelompok ikan dengan simbol status, chip musim, tombol "Ekosistem". Garis pemisah tipis antar blok.
- **Pinbox titik:** versi ringkas dengan koordinat (Mono) di baris atas.
- **Zona di peta:** garis tembaga 2 px, isi tembaga 12%; hover 25%; terpilih garis `--sand`.
- **Grafik:** garis aktual = sand, hindcast = tembaga putus-putus, forecast = tembaga solid dengan pita ketidakpastian (RMSE) transparan, MSY = garis datar putus halus. Metrik RMSE/MAE tampil di bawah grafik.
- **Mawar angin** untuk arah arus: SVG 8 mata angin, panah tembaga.
- **Kartu tim (About):** foto rasio 4:5 monokrom, hover berwarna, nama (Fraunces) dan peran (label kapital kecil).
- **Footer:** dua sisi sesuai skema: kiri "2026 Terrasea-Stock. All rights reserved. Maritime Data Systems.", kanan "Universitas Pendidikan Indonesia" dan "Sistem Informasi Kelautan"; kolom "Jump to feature".

## 7. Layout

- Landing: hero slide, lalu section bergantian `--bg` dan `--paper` supaya ritmenya tidak monoton; penjelasan 2 kolom (teks kiri, ilustrasi peta/kontur kanan).
- Page aplikasi: mode gelap penuh. Peta memenuhi viewport, panel melayang tanpa blur.
- Breakpoint: 640, 960, 1280. Di bawah 960 sidebar menjadi bottom sheet.

## 8. Gerak

Hanya fungsional: transisi sidebar, fade layer (200 ms, `ease-out`), grafik tergambar sekali. Hormati `prefers-reduced-motion`.

## 9. Aksesibilitas

Kontras >= 4,5:1; semua kontrol dapat dijangkau keyboard; indikator tidak bergantung warna; `alt` pada gambar; label ARIA pada kontrol peta.

## 10. Larangan

- Tanpa emoji sebagai ikon (pakai SVG garis 1,5 px, set tunggal).
- Tanpa glassmorphism, gradien ungu/biru-neon, bayangan berat, kartu bulat besar.
- Tanpa Inter/Roboto/Arial sebagai font tampilan.
- Tanpa teks placeholder ("Lorem ipsum", "Your data here"); keadaan kosong memakai kalimat nyata ("Pilih zona untuk melihat grafik").
- Tanpa warna hex langsung di komponen; selalu token.
- Tanpa warna pelangi (jet) untuk data.
