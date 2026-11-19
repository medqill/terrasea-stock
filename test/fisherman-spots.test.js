import test from 'node:test';
import assert from 'node:assert/strict';
import * as data from '../src/data.js';
import {
  haversineKm,
  distToSegmentKm,
  minDistanceToFeatureKm,
  findFishermanSpots
} from '../src/fisherman-spots.js';
import { inFeature } from '../src/geo.js';

test('haversineKm: kalkulasi jarak koordinat akurat', () => {
  // Jarak Jakarta ke Merak sekitar 90-100 km
  const d = haversineKm(-6.2, 106.8, -5.9, 106.0);
  assert.ok(d > 80 && d < 120, `Jarak haversine tidak wajar: ${d}`);
  assert.equal(haversineKm(-6.0, 106.0, -6.0, 106.0), 0);
});

test('distToSegmentKm: jarak ke segmen garis', () => {
  // Garis dari (105.0, -6.0) ke (106.0, -6.0)
  // Titik di (105.5, -6.1) -> jarak sekitar 11 km
  const d = distToSegmentKm(105.5, -6.1, 105.0, -6.0, 106.0, -6.0);
  assert.ok(d > 10.5 && d < 11.5, `Jarak segmen tidak tepat: ${d}`);
});

test('findFishermanSpots: Zona Z-01 dan Z-02 memenuhi semua batasan nelayan', async () => {
  const zones = (await data.getZones())?.data;
  const ab = (await data.getAbundance('2026-11'))?.data;
  const land = (await data.getLand())?.features?.[0];
  const cons = (await data.getConservation())?.features?.[0];

  assert.ok(zones?.features?.length > 0, 'Data zona harus tersedia');
  assert.ok(ab, 'Data kelimpahan harus tersedia');

  for (const zone of zones.features) {
    const zid = zone.properties.zone_id;
    const spots = findFishermanSpots({
      zone,
      abundanceGrid: ab,
      landFeature: land,
      conservationFeature: cons,
      minBufferKm: 5.0,
      minSeparationKm: 18.0
    });

    assert.ok(spots.length > 0, `${zid} harus menghasilkan setidaknya satu titik nelayan`);

    // Validasi jumlah pin per warna
    const counts = { red: 0, blue: 0, green: 0, yellow: 0 };
    for (const spot of spots) {
      counts[spot.color] = (counts[spot.color] || 0) + 1;

      // Wajib berada di dalam zona
      assert.ok(inFeature(zone, spot.lng, spot.lat), `Spot ${spot.id} harus berada di dalam ${zid}`);

      // Tidak boleh berada di daratan / dekat daratan (< 5 km)
      if (land) {
        const dLand = minDistanceToFeatureKm(land, spot.lng, spot.lat);
        assert.ok(dLand >= 4.95, `Spot ${spot.id} terlalu dekat daratan: ${dLand} km`);
      }

      // Tidak boleh berada di konservasi / dekat konservasi (< 5 km)
      if (cons) {
        const dCons = minDistanceToFeatureKm(cons, spot.lng, spot.lat);
        assert.ok(dCons >= 4.95, `Spot ${spot.id} terlalu dekat kawasan konservasi: ${dCons} km`);
      }

      // Properti wajib
      assert.ok(spot.title, 'Spot harus memiliki title');
      assert.ok(spot.desc, 'Spot harus memiliki deskripsi');
      assert.ok(spot.rank >= 1 && spot.rank <= 3, 'Rank spot harus 1..3');
      assert.ok(spot.abundance, 'Spot harus membawa data abundance');
    }

    assert.ok(counts.red <= 1, `${zid}: Pin merah maksimal 1 (dapat: ${counts.red})`);
    assert.ok(counts.blue <= 3, `${zid}: Pin biru maksimal 3 (dapat: ${counts.blue})`);
    assert.ok(counts.green <= 3, `${zid}: Pin hijau maksimal 3 (dapat: ${counts.green})`);
    assert.ok(counts.yellow <= 3, `${zid}: Pin kuning maksimal 3 (dapat: ${counts.yellow})`);

    // Validasi jarak antar semua pin minimal 18 km agar tidak menumpuk
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const dist = haversineKm(spots[i].lat, spots[i].lng, spots[j].lat, spots[j].lng);
        assert.ok(
          dist >= 17.95,
          `Jarak antara spot ${spots[i].id} dan ${spots[j].id} di ${zid} kurang dari 18 km: ${dist.toFixed(2)} km`
        );
      }
    }
  }
});

