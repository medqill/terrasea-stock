// Fungsi murni untuk lookup nilai pada grid harian (dgrid). Tanpa DOM, bisa diuji di Node.
// Konvensi grid (docs/PIPELINE_CONTRACT.md): nilai berada di PUSAT sel, sama seperti saat
// grid digambar sebagai overlay (mapkit.gridOverlay), jadi angka pinbox cocok dengan warna peta.
// bbox = [barat, selatan, timur, utara]; values baris demi baris mulai dari barat laut.

export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Interpolasi bilinear. Mengembalikan null bila titik di luar bbox atau salah satu sel
 * yang berbobot > 0 bernilai null (darat / di luar jangkauan IDW).
 */
export function bilinear(grid, lng, lat) {
  const [west, south, east, north] = grid.bbox;
  if (!(lng >= west && lng <= east && lat >= south && lat <= north)) return null;
  const { nx, ny, values } = grid;

  const colF = Math.min(nx - 1, Math.max(0, ((lng - west) / (east - west)) * nx - 0.5));
  const rowF = Math.min(ny - 1, Math.max(0, ((north - lat) / (north - south)) * ny - 0.5));
  const c0 = Math.floor(colF), r0 = Math.floor(rowF);
  const c1 = Math.min(c0 + 1, nx - 1), r1 = Math.min(r0 + 1, ny - 1);
  const tx = colF - c0, ty = rowF - r0;

  const corners = [
    [values[r0 * nx + c0], (1 - tx) * (1 - ty)],
    [values[r0 * nx + c1], tx * (1 - ty)],
    [values[r1 * nx + c0], (1 - tx) * ty],
    [values[r1 * nx + c1], tx * ty]
  ];
  let sum = 0;
  for (const [v, w] of corners) {
    if (w === 0) continue;
    if (v == null) return null;
    sum += v * w;
  }
  return sum;
}

/**
 * Kecepatan (m/s) dan arah TUJUAN arus (derajat dari utara, searah jarum jam) dari uo (timur)
 * dan vo (utara). Sama dengan konvensi mawar angin di windrose.js.
 * uo=1,vo=0 -> 90 (Timur); uo=0,vo=1 -> 0 (Utara); uo=-1 -> 270 (Barat); vo=-1 -> 180 (Selatan).
 */
export function speedAndDirection(uo, vo) {
  if (uo == null || vo == null) return { speed: null, direction_deg: null };
  const speed = Math.sqrt(uo * uo + vo * vo);
  let deg = (Math.atan2(uo, vo) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return { speed, direction_deg: Math.round(deg) % 360 };
}

export function lookupValue(grid, lng, lat) {
  return grid ? bilinear(grid, lng, lat) : null;
}