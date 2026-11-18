import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FISH_DOMINANCE_CONFIG,
  getZoneNumber,
  resolveAbundance,
  computeDominantFish
} from '../public/js/fish-dominance.js';

test('foto ikan: semua file yang didaftarkan di konfigurasi harus ada di /public/img/foto_ikan', () => {
  for (const [zoneNum, groups] of Object.entries(FISH_DOMINANCE_CONFIG)) {
    for (const [groupKey, fishList] of Object.entries(groups)) {
      for (const fish of fishList) {
        const filePath = path.join(process.cwd(), 'public', fish.image.replace(/^\//, ''));
        assert.ok(
          fs.existsSync(filePath),
          `Berkas gambar untuk ${fish.name} (${fish.image}) tidak ditemukan di ${filePath}`
        );
      }
    }
  }
});

test('getZoneNumber: deteksi nomor zona dari id atau nama', () => {
  assert.equal(getZoneNumber('Z-01', 'Teluk Banten'), 1);
  assert.equal(getZoneNumber('Z-02', 'Banten Selatan'), 2);
  assert.equal(getZoneNumber('Z-01', 'Wilayah Karangantu'), 1);
  assert.equal(getZoneNumber('Z-02', 'Wilayah Lebak'), 2);
  assert.equal(getZoneNumber('', 'Area Bawah'), 2);
});

test('resolveAbundance: aturan kedalaman laut (batimetri) untuk demersal', () => {
  const base = { pelagis_besar: 'mid', pelagis_kecil: 'mid', demersal: 'mid' };

  // 40-60m -> high
  assert.equal(resolveAbundance(base, 45).demersal, 'high');
  assert.equal(resolveAbundance(base, 40).demersal, 'high');
  assert.equal(resolveAbundance(base, 60).demersal, 'high');

  // 0-40m -> mid
  assert.equal(resolveAbundance(base, 25).demersal, 'mid');
  assert.equal(resolveAbundance(base, 0).demersal, 'mid');
  assert.equal(resolveAbundance(base, 39.9).demersal, 'mid');

  // >60m -> low
  assert.equal(resolveAbundance(base, 60.1).demersal, 'low');
  assert.equal(resolveAbundance(base, 100).demersal, 'low');

  // tanpa depth -> tetap bawaan
  assert.equal(resolveAbundance(base, null).demersal, 'mid');
});

test('computeDominantFish Zona 1: semua sangat berlimpah (high) dibatasi maks 4 dengan prioritas', () => {
  const abund = { pelagis_besar: 'high', pelagis_kecil: 'high', demersal: 'high' };
  const res = computeDominantFish(1, abund, 4);

  // Pelagis besar: Tenggiri (#1), Tongkol (#2) = 2
  // Pelagis kecil: Kembung (#1), Tembang (#2) = 2
  // Total = 4. Demersal terpotong oleh batasan 4.
  assert.equal(res.length, 4);
  assert.equal(res[0].name, 'Tenggiri');
  assert.equal(res[1].name, 'Tongkol');
  assert.equal(res[2].name, 'Kembung');
  assert.equal(res[3].name, 'Tembang');
});

test('computeDominantFish Zona 1: pelagis besar & kecil mid, demersal high -> 1 + 1 + 2 = 4', () => {
  const abund = { pelagis_besar: 'mid', pelagis_kecil: 'mid', demersal: 'high' };
  const res = computeDominantFish(1, abund, 4);

  // Pelagis besar: Tenggiri (1)
  // Pelagis kecil: Kembung (1)
  // Demersal: Kuniran (1), Peperek (2) = 2
  // Total = 4
  assert.equal(res.length, 4);
  assert.equal(res[0].name, 'Tenggiri');
  assert.equal(res[1].name, 'Kembung');
  assert.equal(res[2].name, 'Kuniran');
  assert.equal(res[3].name, 'Peperek');
});

test('computeDominantFish Zona 1: pelagis besar low -> tidak ditampilkan, ambil grup selanjutnya', () => {
  const abund = { pelagis_besar: 'low', pelagis_kecil: 'mid', demersal: 'high' };
  const res = computeDominantFish(1, abund, 4);

  // Pelagis besar: 0
  // Pelagis kecil: Kembung (1)
  // Demersal: Kuniran, Peperek (2)
  // Total = 3
  assert.equal(res.length, 3);
  assert.equal(res[0].name, 'Kembung');
  assert.equal(res[1].name, 'Kuniran');
  assert.equal(res[2].name, 'Peperek');
});

test('computeDominantFish Zona 2: pelagis besar high, pelagis kecil high, demersal high', () => {
  const abund = { pelagis_besar: 'high', pelagis_kecil: 'high', demersal: 'high' };
  const res = computeDominantFish(2, abund, 4);

  // Pelagis besar: Cakalang (#1), Tuna (#2) = 2
  // Pelagis kecil: Layang (#1) = 1 (karena hanya ada 1 di daftar Zona 2)
  // Demersal: Kapas-kapas (#1) = 1 (karena batas total 4 tercapai)
  // Total = 4
  assert.equal(res.length, 4);
  assert.equal(res[0].name, 'Cakalang');
  assert.equal(res[1].name, 'Tuna');
  assert.equal(res[2].name, 'Layang');
  assert.equal(res[3].name, 'Kapas-kapas');
});

test('computeDominantFish Zona 2: pelagis besar low, pelagis kecil mid, demersal high', () => {
  const abund = { pelagis_besar: 'low', pelagis_kecil: 'mid', demersal: 'high' };
  const res = computeDominantFish(2, abund, 4);

  // Pelagis besar: 0
  // Pelagis kecil: Layang (#1) = 1
  // Demersal: Kapas-kapas (#1), Kakap Merah (#2) = 2
  // Total = 3
  assert.equal(res.length, 3);
  assert.equal(res[0].name, 'Layang');
  assert.equal(res[1].name, 'Kapas-kapas');
  assert.equal(res[2].name, 'Kakap Merah');
});

test('computeDominantFish: semua low mengembalikan array kosong', () => {
  const abund = { pelagis_besar: 'low', pelagis_kecil: 'low', demersal: 'low' };
  const res = computeDominantFish(1, abund, 4);
  assert.equal(res.length, 0);
});

