// Pembuat data FIXTURE untuk pengembangan frontend. BUKAN hasil model.
// Semua berkas diberi awalan fixture_ dan UI menampilkan penanda "Data fixture".
// Hapus berkas fixture_* setelah pipeline ml/ (Nazma) menghasilkan data asli.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'data', 'processed');
const GEO = path.join(root, 'data', 'geo');
fs.mkdirSync(path.join(OUT, 'grids'), { recursive: true });
fs.mkdirSync(GEO, { recursive: true });

const write = (file, obj) => fs.writeFileSync(file, JSON.stringify(obj));
const tac = Number(/tac_factor:\s*([\d.]+)/.exec(fs.readFileSync(path.join(root, 'ml', 'config.yaml'), 'utf8'))[1]);
const MODEL_VERSION = 'fixture-0.0.1';
const GENERATED_AT = '2026-11-07T00:00:00.000Z';
const MONTH = '2026-11';
const GROUPS = ['pelagis_besar', 'pelagis_kecil', 'demersal'];

let seed = 7;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

// Daratan kasar (fixture). Pesisir: utara dari timur ke barat, lalu pesisir barat ke selatan.
const COAST = [[106.6, -6.02], [106.3, -6.03], [106.17, -6.02], [106.08, -5.98], [106.0, -5.93], [105.95, -6.02], [105.92, -6.05], [105.86, -6.2], [105.82, -6.3], [105.8, -6.4], [105.74, -6.48], [105.65, -6.52]];
const land = { type: 'Feature', properties: { name: 'Daratan (fixture)' }, geometry: { type: 'Polygon', coordinates: [[...COAST, [105.6, -6.95], [106.6, -6.95], COAST[0]]] } };
write(path.join(GEO, 'fixture_land.geojson'), { type: 'FeatureCollection', features: [land] });

function inRing(x, y, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; }
const onLand = (x, y) => inRing(x, y, land.geometry.coordinates[0]);

// Interpolasi pesisir
const northSeg = COAST.slice(0, 5); // lng menurun
const westSeg = COAST.slice(4);     // lat menurun
function coastLat(lng) { for (let i = 0; i < northSeg.length - 1; i++) { const [x1, y1] = northSeg[i], [x2, y2] = northSeg[i + 1]; if (lng <= x1 && lng >= x2) return y1 + ((lng - x1) / (x2 - x1)) * (y2 - y1); } return northSeg.at(-1)[1]; }
function coastLng(lat) { for (let i = 0; i < westSeg.length - 1; i++) { const [x1, y1] = westSeg[i], [x2, y2] = westSeg[i + 1]; if (lat <= y1 && lat >= y2) return x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1); } return westSeg.at(-1)[0]; }

const W = 0.0165, H = 0.0155;
const areaHa = (w, s, e, n) => { const lat = (s + n) / 2; return Math.round(((e - w) * 111320 * Math.cos((lat * Math.PI) / 180) * (n - s) * 110570) / 100) / 100; };
// Sisi persegi diletakkan tepat pada garis pantai fixture (tidak menembus daratan).
const north = (west) => { const s = Math.max(coastLat(west), coastLat(west + W)); return [west, s, west + W, s + H]; };
const westOf = (south) => { const e = Math.min(coastLng(south), coastLng(south + H)); return [e - W, south, e, south + H]; };

const ZONES = [
  { id: 'Z-01', name: 'Teluk Banten Barat', box: north(106.03) },
  { id: 'Z-02', name: 'Teluk Banten Timur', box: north(106.18) },
  { id: 'Z-03', name: 'Selat Sunda Utara', box: westOf(-6.0) },
  { id: 'Z-04', name: 'Selat Sunda Tengah', box: westOf(-6.11) },
  { id: 'Z-05', name: 'Selat Sunda Selatan', box: westOf(-6.34) },
  { id: 'Z-06', name: 'Banten Selatan', box: westOf(-6.45) }
];
const rect = ([w, s, e, n]) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];

const MONTHS = Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
const CLASSES = ['high', 'mid', 'low'];
const features = [], eco = [];

ZONES.forEach((z, zi) => {
  const level = 40 + zi * 4 + rnd() * 4;
  const shares = (() => { const a = 0.3 + rnd() * 0.15, b = 0.25 + rnd() * 0.15; return [a, b, 1 - a - b]; })();
  const series = [];
  const make = (m, i, kind) => {
    const season = 1 + 0.12 * Math.sin(((i - 1) / 12) * 2 * Math.PI);
    const actual = kind === 'forecast' ? null : r1(level * season + (rnd() - 0.5) * 3);
    const pred = r1(Math.max(0, (actual ?? level * season) + (rnd() - 0.5) * 2.4));
    const msy = r1(level * 1.12 * season);
    const by_group = {};
    GROUPS.forEach((g, gi) => {
      by_group[g] = { actual_catch: actual === null ? null : r1(actual * shares[gi]), hindcast: r1(pred * shares[gi]), msy: r1(msy * shares[gi]) };
    });
    series.push({ month: m, actual_catch: actual, hindcast: pred, msy, kind, by_group });
  };
  MONTHS.forEach((m, i) => make(m, i, 'hindcast'));
  make(MONTH, 10, 'forecast');

  const test = series.filter((s) => s.kind === 'hindcast').slice(-2); // fixture: n_test = 2
  const err = test.map((s) => s.hindcast - s.actual_catch);
  const metrics = { rmse: r2(Math.sqrt(err.reduce((a, b) => a + b * b, 0) / err.length)), mae: r2(err.reduce((a, b) => a + Math.abs(b), 0) / err.length), n_test: test.length, n_components: 3 };

  const dirs = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
  const params = [...MONTHS, MONTH].map((m, i) => {
    const deg = Math.round((120 + zi * 25 + i * 6) % 360);
    return { month: m, sst: r1(28.4 + zi * 0.12 + 0.9 * Math.sin((i / 12) * 2 * Math.PI) + rnd() * 0.2), chl: r2(1.0 + (zi % 3) * 0.25 + rnd() * 0.2), speed: r2(0.25 + zi * 0.06 + rnd() * 0.08), direction_deg: deg, direction_label: dirs[Math.round(deg / 45) % 8] };
  });
  write(path.join(OUT, `fixture_forecast_${z.id}.json`), { zone_id: z.id, model_version: MODEL_VERSION, generated_at: GENERATED_AT, metrics, series, params });

  const fc = series.at(-1);
  const msy = Object.fromEntries(GROUPS.map((g) => [g, fc.by_group[g].msy]));
  msy.total = r1(GROUPS.reduce((a, g) => a + msy[g], 0));
  const tacV = Object.fromEntries(Object.entries(msy).map(([k, v]) => [k, r1(v * tac)]));
  const abundance = Object.fromEntries(GROUPS.map((g) => [g, CLASSES[Math.floor(rnd() * 3)]]));
  features.push({
    type: 'Feature',
    properties: { zone_id: z.id, name: z.name, area_ha: areaHa(...z.box), touches_coast: true, month: MONTH, msy, tac: tacV, abundance, season: { label: 'Peralihan II', note: 'Isi dari Devina; ini teks fixture.' }, model_version: MODEL_VERSION, generated_at: GENERATED_AT },
    geometry: { type: 'Polygon', coordinates: rect(z.box) }
  });

  const [w, s, e, n] = z.box, dw = e - w, dh = n - s;
  const coral = [w + dw * 0.1, s + dh * 0.15, w + dw * 0.45, s + dh * 0.5];
  const grass = [w + dw * 0.55, s + dh * 0.5, w + dw * 0.9, s + dh * 0.85];
  eco.push({ type: 'Feature', properties: { type: 'coral', zone_id: z.id, name: `Terumbu karang ${z.id} (fixture)`, area_ha: areaHa(...coral) }, geometry: { type: 'Polygon', coordinates: rect(coral) } });
  eco.push({ type: 'Feature', properties: { type: 'seagrass', zone_id: z.id, name: `Lamun ${z.id} (fixture)`, area_ha: areaHa(...grass) }, geometry: { type: 'Polygon', coordinates: rect(grass) } });
});
write(path.join(OUT, 'fixture_zones.geojson'), { type: 'FeatureCollection', features });
write(path.join(OUT, 'fixture_ecosystem.geojson'), { type: 'FeatureCollection', features: eco });

// Grid: bbox [barat, selatan, timur, utara], values baris demi baris mulai dari barat laut, null = darat.
const bbox = [105.55, -6.75, 106.35, -5.85], nx = 32, ny = 36;
const cell = (ix, iy) => [bbox[0] + ((ix + 0.5) / nx) * (bbox[2] - bbox[0]), bbox[3] - ((iy + 0.5) / ny) * (bbox[3] - bbox[1])];
const fields = { sst: [], chl: [], current: [], dir: [] };
for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
  const [x, y] = cell(ix, iy);
  if (onLand(x, y)) { Object.values(fields).forEach((a) => a.push(null)); continue; }
  const t = (x - bbox[0]) / (bbox[2] - bbox[0]);
  fields.sst.push(r1(28.3 + 1.4 * t + 0.3 * Math.sin(y * 40)));
  fields.chl.push(r2(0.8 + 1.0 * t + 0.15 * Math.cos(x * 50)));
  fields.current.push(r2(0.7 - 0.45 * t + 0.05 * Math.sin(x * 60)));
  fields.dir.push(Math.round(130 + 40 * t + 10 * Math.sin(y * 30)));
}
const gridBase = (v, unit, values) => { const nums = values.filter((x) => x !== null); return { var: v, unit, month: MONTH, bbox, nx, ny, values, vmin: Math.min(...nums), vmax: Math.max(...nums), model_version: MODEL_VERSION, generated_at: GENERATED_AT }; };
write(path.join(OUT, 'grids', `fixture_sst_${MONTH}.json`), gridBase('sst', '°C', fields.sst));
write(path.join(OUT, 'grids', `fixture_chl_${MONTH}.json`), gridBase('chl', 'mg/m³', fields.chl));
write(path.join(OUT, 'grids', `fixture_current_${MONTH}.json`), { ...gridBase('current', 'm/s', fields.current), direction_deg: fields.dir });

// Pengganti ml/03_habitat: kelas kelimpahan per sel (aturan sederhana, hanya untuk fixture).
const cls = (v, lo, hi) => (v === null ? null : v >= hi ? 'high' : v >= lo ? 'mid' : 'low');
write(path.join(OUT, 'grids', `fixture_abundance_${MONTH}.json`), {
  month: MONTH, bbox, nx, ny, model_version: MODEL_VERSION, generated_at: GENERATED_AT,
  groups: {
    pelagis_besar: fields.current.map((v) => cls(v, 0.35, 0.5)),
    pelagis_kecil: fields.chl.map((v) => cls(v, 1.1, 1.5)),
    demersal: fields.sst.map((v, i) => cls(fields.chl[i] === null ? null : 3 - Math.abs(v - 29.2) - Math.abs(fields.chl[i] - 1.3), 1.4, 2.4))
  }
});
console.log('Fixture dibuat. Luas zona (ha):', features.map((f) => f.properties.area_ha).join(', '));
