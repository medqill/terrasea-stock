import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  extractValidWaterPoints,
  calculateNextPosition,
  computeParticleAlpha
} from '../public/js/current-flow.js';

test('current-flow: extractValidWaterPoints mengekstrak sel laut dan mengabaikan daratan', () => {
  const dummyGrid = {
    bbox: [104.0, -7.0, 106.0, -5.0],
    nx: 2,
    ny: 2,
    uo: [0.2, null, -0.1, 0.4],
    vo: [0.1, null, 0.3, -0.2]
  };

  const pts = extractValidWaterPoints(dummyGrid);
  assert.equal(pts.length, 3, 'Harus mengekstrak tepat 3 titik laut (mengabaikan 1 sel null)');
  assert.equal(pts[0].u, 0.2);
  assert.equal(pts[0].v, 0.1);
  assert.equal(pts[1].u, -0.1);
  assert.equal(pts[2].u, 0.4);
});

test('current-flow: extractValidWaterPoints menangani berkas grid arus nyata', () => {
  const raw = fs.readFileSync('data/processed/dgrid_current_2026-11-18.json', 'utf8');
  const grid = JSON.parse(raw);
  const pts = extractValidWaterPoints(grid);

  assert.ok(pts.length > 500, `Titik laut valid harus cukup banyak, ditemukan ${pts.length}`);
  pts.forEach((p) => {
    assert.ok(p.u != null && p.v != null, 'Setiap titik harus memiliki u dan v bukan null');
    assert.ok(p.lng >= grid.bbox[0] && p.lng <= grid.bbox[2], 'Bujur harus di dalam bbox');
    assert.ok(p.lat >= grid.bbox[1] && p.lat <= grid.bbox[3], 'Lintang harus di dalam bbox');
  });
});

test('current-flow: calculateNextPosition menghitung posisi vektor berikutnya', () => {
  const lng = 105.5;
  const lat = -6.0;
  const u = 0.2; // timur
  const v = 0.1; // utara
  const speedFactor = 0.003;

  const res = calculateNextPosition(lng, lat, u, v, speedFactor);
  assert.ok(res, 'Hasil tidak boleh null');
  assert.equal(res.nextLng, 105.5 + 0.2 * 0.003);
  assert.equal(res.nextLat, -6.0 + 0.1 * 0.003);

  const nullRes = calculateNextPosition(lng, lat, null, 0.1, speedFactor);
  assert.equal(nullRes, null, 'Jika u atau v bernilai null harus mengembalikan null');
});

test('current-flow: computeParticleAlpha menghasilkan opasitas adaptif', () => {
  const minAlpha = computeParticleAlpha(0.01, 0.05, 0.5);
  const midAlpha = computeParticleAlpha(0.275, 0.05, 0.5);
  const maxAlpha = computeParticleAlpha(0.6, 0.05, 0.5);

  assert.ok(minAlpha >= 0.35 && minAlpha <= 0.4, `Opasitas minimal harus sekitar 0.35, dapat ${minAlpha}`);
  assert.ok(midAlpha > minAlpha && midAlpha < maxAlpha, 'Opasitas kecepatan sedang harus di antara min dan max');
  assert.ok(maxAlpha >= 0.85 && maxAlpha <= 0.95, `Opasitas maksimal harus mendekati 0.9, dapat ${maxAlpha}`);
});

