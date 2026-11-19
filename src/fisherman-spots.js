import { inFeature } from './geo.js';

const SCORE_MAP = { high: 3, mid: 2, low: 1 };

/**
 * Jarak lingkaran besar antara dua koordinat (haversine) dalam kilometer.
 */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Jarak terpendek dari titik (lng, lat) ke segmen garis [A, B] dalam kilometer.
 */
export function distToSegmentKm(lng, lat, lngA, latA, lngB, latB) {
  const avgLatRad = (((latA + latB) / 2) * Math.PI) / 180;
  const kx = 111.32 * Math.cos(avgLatRad);
  const ky = 110.574;
  const dx = (lngB - lngA) * kx;
  const dy = (latB - latA) * ky;
  const px = (lng - lngA) * kx;
  const py = (lat - latA) * ky;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) return Math.sqrt(px * px + py * py);
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
  const projX = px - t * dx;
  const projY = py - t * dy;
  return Math.sqrt(projX * projX + projY * projY);
}

/**
 * Jarak minimum dari titik ke batas fitur poligon (daratan / konservasi).
 * Mengembalikan 0 jika titik berada di dalam poligon.
 */
export function minDistanceToFeatureKm(feature, lng, lat, maxSearchKm = 10.0) {
  if (!feature) return Infinity;
  if (inFeature(feature, lng, lat)) return 0;
  let minDist = Infinity;
  const geom = feature.geometry;
  const polys =
    geom.type === 'MultiPolygon'
      ? geom.coordinates
      : geom.type === 'Polygon'
        ? [geom.coordinates]
        : [];
  const degBuffer = maxSearchKm / 100.0;
  for (const poly of polys) {
    const ring = poly[0];
    if (!ring) continue;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const minX = Math.min(ring[j][0], ring[i][0]) - degBuffer;
      const maxX = Math.max(ring[j][0], ring[i][0]) + degBuffer;
      const minY = Math.min(ring[j][1], ring[i][1]) - degBuffer;
      const maxY = Math.max(ring[j][1], ring[i][1]) + degBuffer;
      if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;

      const d = distToSegmentKm(lng, lat, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
      if (d < minDist) minDist = d;
    }
  }
  return minDist;
}

/**
 * Cari titik potensial nelayan (Fisherman Spots) dalam zona tertentu:
 * - 1 titik Merah: Potensi kelimpahan maksimal (semua kelompok sangat berlimpah / komposit tertinggi)
 * - Maksimal 3 titik Biru: Potensi terbaik Pelagis Besar (Rank #1..#3)
 * - Maksimal 3 titik Hijau: Potensi terbaik Pelagis Kecil (Rank #1..#3)
 * - Maksimal 3 titik Kuning: Potensi terbaik Demersal (Rank #1..#3)
 * 
 * Aturan spasial:
 * - Berada di dalam batas zona yang dikunci.
 * - Tidak di daratan / konservasi dan berjarak > minBufferKm (default 5 km) dari keduanya.
 * - Antar semua pin yang terpilih berjarak minimal minSeparationKm (default 5 km).
 */
export function findFishermanSpots({
  zone,
  abundanceGrid,
  landFeature,
  conservationFeature,
  minBufferKm = 5.0,
  minSeparationKm = 18.0
}) {
  if (!zone || !abundanceGrid || !abundanceGrid.groups) return [];

  const [w, s, e, n] = abundanceGrid.bbox;
  const candidates = [];

  for (let iy = 0; iy < abundanceGrid.ny; iy++) {
    const lat = n - (iy + 0.5) * ((n - s) / abundanceGrid.ny);
    for (let ix = 0; ix < abundanceGrid.nx; ix++) {
      const lng = w + (ix + 0.5) * ((e - w) / abundanceGrid.nx);

      // Wajib berada di dalam zona
      if (!inFeature(zone, lng, lat)) continue;

      // Tidak boleh berada di daratan atau dekat daratan (< minBufferKm)
      if (landFeature && minDistanceToFeatureKm(landFeature, lng, lat, minBufferKm + 2) < minBufferKm) continue;

      // Tidak boleh berada di konservasi atau dekat kawasan konservasi (< minBufferKm)
      if (conservationFeature && minDistanceToFeatureKm(conservationFeature, lng, lat, minBufferKm + 2) < minBufferKm) continue;

      const idx = iy * abundanceGrid.nx + ix;
      const pb = abundanceGrid.groups.pelagis_besar?.[idx] || 'low';
      const pk = abundanceGrid.groups.pelagis_kecil?.[idx] || 'low';
      const dm = abundanceGrid.groups.demersal?.[idx] || 'low';

      const sPb = abundanceGrid.dailyScores?.pelagis_besar?.[idx] ?? (SCORE_MAP[pb] || 1);
      const sPk = abundanceGrid.dailyScores?.pelagis_kecil?.[idx] ?? (SCORE_MAP[pk] || 1);
      const sDm = abundanceGrid.dailyScores?.demersal?.[idx] ?? (SCORE_MAP[dm] || 1);

      // Indikator semua kelompok ikan sangat berlimpah mendapatkan prioritas tertinggi (+100)
      const allHigh = pb === 'high' && pk === 'high' && dm === 'high';
      const compositeScore = abundanceGrid.dailyScores?.all?.[idx] ?? (sPb + sPk + sDm + (allHigh ? 100 : 0));

      candidates.push({
        lat: Number(lat.toFixed(4)),
        lng: Number(lng.toFixed(4)),
        ix,
        iy,
        abundance: { pelagis_besar: pb, pelagis_kecil: pk, demersal: dm },
        scores: { all: compositeScore, pelagis_besar: sPb, pelagis_kecil: sPk, demersal: sDm },
        allHigh
      });
    }
  }

  const selected = [];

  function isFarEnough(cand, minDistance = minSeparationKm) {
    return selected.every((s) => haversineKm(cand.lat, cand.lng, s.lat, s.lng) >= minDistance);
  }

  // 1. PIN MERAH: Potensi kelimpahan maksimal (hanya 1 titik)
  const redSorted = [...candidates].sort((a, b) => b.scores.all - a.scores.all);
  if (redSorted.length > 0) {
    const red = redSorted[0];
    selected.push({
      id: 'spot-red-1',
      category: 'all',
      categoryLabel: 'Semua Kelompok Ikan',
      color: 'red',
      colorHex: '#EF4444',
      rank: 1,
      lat: red.lat,
      lng: red.lng,
      title: 'Potensi Maksimal (Semua Kelompok)',
      desc: red.allHigh
        ? 'Semua kelompok ikan sangat berlimpah di titik ini. Fishing ground paling ideal untuk operasi tangkap beragam alat.'
        : 'Titik dengan akumulasi kelimpahan ikan gabungan paling optimal di dalam zona ini.',
      abundance: red.abundance
    });
  }

  // Helper untuk memilih kategori spesifik (maks 3 titik per kategori)
  function selectCategorySpots(catKey, catColor, catHex, catLabel, titlePrefix, descBuilder) {
    const sorted = [...candidates].sort((a, b) => {
      // Prioritaskan skor kategori terkait
      if (b.scores[catKey] !== a.scores[catKey]) {
        return b.scores[catKey] - a.scores[catKey];
      }
      // Tie-breaker: total kelimpahan kelompok lain
      return b.scores.all - a.scores.all;
    });

    let rank = 1;
    for (const cand of sorted) {
      if (rank > 3) break;
      if (isFarEnough(cand, minSeparationKm)) {
        selected.push({
          id: `spot-${catColor}-${rank}`,
          category: catKey,
          categoryLabel: catLabel,
          color: catColor,
          colorHex: catHex,
          rank,
          lat: cand.lat,
          lng: cand.lng,
          title: `${titlePrefix} (Rank #${rank})`,
          desc: descBuilder(cand.abundance[catKey], rank),
          abundance: cand.abundance
        });
        rank++;
      }
    }
  }

  // 2. PIN BIRU: Pelagis Besar (maksimal 3 titik)
  selectCategorySpots(
    'pelagis_besar',
    'blue',
    '#3B82F6',
    'Pelagis Besar',
    'Spot Pelagis Besar',
    (status, rank) =>
      `Lokasi prioritas #${rank} untuk penangkapan kelompok Pelagis Besar (Tongkol, Tenggiri, Cakalang, Tuna) dengan status ${status === 'high' ? 'sangat berlimpah' : 'berlimpah'}.`
  );

  // 3. PIN HIJAU: Pelagis Kecil (maksimal 3 titik)
  selectCategorySpots(
    'pelagis_kecil',
    'green',
    '#10B981',
    'Pelagis Kecil',
    'Spot Pelagis Kecil',
    (status, rank) =>
      `Lokasi prioritas #${rank} untuk penangkapan kelompok Pelagis Kecil (Kembung, Tembang, Layang, Teri) dengan status ${status === 'high' ? 'sangat berlimpah' : 'berlimpah'}.`
  );

  // 4. PIN KUNING: Demersal (maksimal 3 titik)
  selectCategorySpots(
    'demersal',
    'yellow',
    '#F59E0B',
    'Demersal',
    'Spot Demersal',
    (status, rank) =>
      `Lokasi prioritas #${rank} untuk penangkapan kelompok Ikan Demersal (Kakap Merah, Kerapu, Kuniran, Peperek, Kapas-kapas) dengan status ${status === 'high' ? 'sangat berlimpah' : 'berlimpah'}.`
  );

  return selected;
}

