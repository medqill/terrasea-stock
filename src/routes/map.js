import { Router } from 'express';
import * as data from '../data.js';
import { zoneAt } from '../geo.js';
import { asyncHandler } from '../async-handler.js';

const r = Router();
const notFound = (res, message) => res.status(404).json({ message });

r.get('/config', (req, res) => {
  let key = process.env.MAPTILER_KEY || null;
  if (key) {
    key = key.trim().replace(/^["']|["']$/g, '');
    if (key.includes('key=')) {
      const m = key.match(/key=([a-zA-Z0-9_-]+)/);
      if (m) key = m[1];
    }
  }
  let mapId = process.env.MAPTILER_MAP_ID || 'dataviz-dark';
  if (mapId) {
    mapId = mapId.trim().replace(/^["']|["']$/g, '');
    if (mapId.includes('/maps/')) {
      const m = mapId.match(/\/maps\/([a-zA-Z0-9_-]+)/);
      if (m) mapId = m[1];
    }
  }
  res.json({ maptilerKey: key, maptilerMapId: mapId || 'dataviz-dark' });
});

r.get('/meta', asyncHandler(async (req, res) => {
  const m = await data.meta();
  m ? res.json(m) : notFound(res, 'Data olahan belum tersedia. Jalankan pipeline di ml/.');
}));

r.get('/zones', asyncHandler(async (req, res) => {
  console.log('[API] GET /zones requested by', req.user?.email);
  const { month } = req.query;
  if (month !== undefined && !data.isMonth(month)) return res.status(400).json({ message: 'Format bulan harus YYYY-MM.' });
  let z = await data.getZones();
  console.log('[API] GET /zones found:', !!z, 'features:', z?.data?.features?.length);
  if (!z) return notFound(res, 'Data zona belum tersedia.');
  if (month && z.data.features[0]?.properties.month !== month) return notFound(res, `Data zona bulan ${month} belum tersedia.`);
  res.json({ ...z.data, is_fixture: z.fixture });
}));

r.get('/ecosystem', asyncHandler(async (req, res) => {
  const e = await data.getEcosystem();
  e ? res.json({ ...e.data, is_fixture: e.fixture }) : notFound(res, 'Data ekosistem belum tersedia.');
}));

r.get('/geo-zones', asyncHandler(async (req, res) => {
  const gz = await data.getZones();
  gz ? res.json(gz.data) : notFound(res, 'Data zona tidak ditemukan di data/geo/.');
}));

r.get('/land', asyncHandler(async (req, res) => {
  console.log('[API] GET /land requested by', req.user?.email);
  const l = await data.getLand();
  console.log('[API] GET /land found:', !!l, 'features:', l?.data?.features?.length);
  l ? res.json(l.data) : notFound(res, 'Data daratan belum tersedia di data/geo/.');
}));

r.get('/grids/:var', asyncHandler(async (req, res) => {
  const month = req.query.month ?? (await data.meta())?.month;
  if (!data.GRID_VARS.includes(req.params.var)) return res.status(400).json({ message: 'Variabel harus sst, chl, current, atau bathymetry.' });
  if (!data.isMonth(month)) return res.status(400).json({ message: 'Format bulan harus YYYY-MM.' });
  const g = await data.getGrid(req.params.var, month);
  g ? res.json({ ...g.data, is_fixture: g.fixture }) : notFound(res, `Grid ${req.params.var} bulan ${month} belum tersedia.`);
}));

// Rentang waktu H-3..H+3 (hanya baca artifact; tidak ada perhitungan model di sini).
r.get('/ocean-window', asyncHandler(async (req, res) => {
  const w = await data.getOceanWindow();
  w ? res.json({ ...w.data, is_fixture: w.fixture }) : notFound(res, 'Prakiraan harian belum tersedia.');
}));

r.get('/dgrids/:var', asyncHandler(async (req, res) => {
  const { date } = req.query;
  if (!data.GRID_VARS.includes(req.params.var)) return res.status(400).json({ message: 'Variabel harus sst, chl, current, atau bathymetry.' });
  if (!data.isDate(date)) return res.status(400).json({ message: 'Parameter date harus berformat YYYY-MM-DD.' });
  const g = await data.getDgrid(req.params.var, date);
  g ? res.json({ ...g.data, is_fixture: g.fixture }) : notFound(res, `Grid harian ${req.params.var} tanggal ${date} belum tersedia.`);
}));

// Ambil nilai sel grid terdekat. Hanya lookup, tidak ada perhitungan model.
function sample(grid, lng, lat) {
  const [w, s, e, n] = grid.bbox;
  const ix = Math.min(grid.nx - 1, Math.max(0, Math.floor(((lng - w) / (e - w)) * grid.nx)));
  const iy = Math.min(grid.ny - 1, Math.max(0, Math.floor(((n - lat) / (n - s)) * grid.ny)));
  return iy * grid.nx + ix;
}

r.get('/point', asyncHandler(async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const month = req.query.month ?? (await data.meta())?.month;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return res.status(400).json({ message: 'Koordinat tidak valid.' });
  if (!data.isMonth(month)) return res.status(400).json({ message: 'Format bulan harus YYYY-MM.' });

  const zones = await data.getZones();
  if (!zones) return notFound(res, 'Data zona belum tersedia.');
  const zone = zoneAt(zones.data, lng, lat);
  if (!zone) return notFound(res, 'Titik berada di luar zona. Klik di dalam zona terpilih.');

  const [sst, chl, cur, ab, bathy] = await Promise.all([
    data.getGrid('sst', month),
    data.getGrid('chl', month),
    data.getGrid('current', month),
    data.getAbundance(month),
    data.getGrid('bathymetry', month)
  ]);
  if (!sst || !chl || !cur || !ab) return notFound(res, `Grid bulan ${month} belum lengkap.`);

  const abundance = {};
  for (const g of data.GROUPS) abundance[g] = ab.data.groups[g]?.[sample(ab.data, lng, lat)] ?? null;
  const depthVal = bathy?.data?.values?.[sample(bathy.data, lng, lat)] ?? null;

  res.json({
    zone_id: zone.properties.zone_id, lat, lng, month,
    sst: sst.data.values[sample(sst.data, lng, lat)] ?? null,
    chl: chl.data.values[sample(chl.data, lng, lat)] ?? null,
    speed: cur.data.values[sample(cur.data, lng, lat)] ?? null,
    direction_deg: cur.data.direction_deg?.[sample(cur.data, lng, lat)] ?? null,
    depth: depthVal != null ? Number(depthVal) : null,
    abundance,
    is_fixture: zones.fixture
  });
}));

export default r;
