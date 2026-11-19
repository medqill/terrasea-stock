// Pembaca data olahan (artifacts) dari database Turso dan data/geo.
// Sumber utama: tabel artifacts (diunggah oleh pipeline ML).
// Fallback: data/processed/ (fixture_* jika tabel kosong), hanya untuk artifact bulanan.
// MSY, TAC, dan kelas kelimpahan dihitung di ml/ (ARCHITECTURE prinsip 2), bukan di sini.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const PROCESSED = path.join(root, 'processed');
const GEO = path.join(root, 'geo');

const cache = new Map();
const TTL_MS = 60 * 1000; // In-memory cache TTL 60 detik

export const isMonth = (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
export const isDate = (v) => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
export const isZoneId = (v) => typeof v === 'string' && /^Z-\d{2}$/.test(v);
export const GRID_VARS = ['sst', 'chl', 'current', 'bathymetry'];
export const GROUPS = ['pelagis_besar', 'pelagis_kecil', 'demersal'];

export function clearCache() {
  cache.clear();
}

/** Coba berkas asli dulu; bila belum ada, pakai fixture_ (ditandai is_fixture). */
function loadFile(dir, rel) {
  const base = path.basename(rel);
  const sub = path.dirname(rel);
  for (const name of [base, `fixture_${base}`]) {
    const file = path.join(dir, sub, name);
    try {
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file, 'utf8');
      return { data: JSON.parse(content), fixture: name.startsWith('fixture_') };
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Muat artifact dari tabel `artifacts` dengan fallback ke berkas processed (bila fallbackRel diberikan).
 * Mendukung pencarian nama dengan pemisah ':' maupun '_'.
 */
async function loadArtifact(name, fallbackRel) {
  const now = Date.now();
  const hit = cache.get(name);
  if (hit && now < hit.expiresAt) return hit.value;

  const altName = name.includes(':') ? name.replace(/:/g, '_') : name.replace(/_/g, ':');
  try {
    const row = await db.one(
      'SELECT name, month, content, model_version, generated_at, is_fixture FROM artifacts WHERE name = ? OR name = ? LIMIT 1',
      [name, altName]
    );
    if (row && row.content) {
      let parsed = row.content;
      if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { parsed = null; }
      }
      if (parsed) {
        const val = {
          data: parsed,
          fixture: Boolean(row.is_fixture),
          model_version: row.model_version,
          generated_at: row.generated_at,
          month: row.month
        };
        cache.set(name, { value: val, expiresAt: now + TTL_MS });
        return val;
      }
    }
  } catch {
    // DB offline atau tabel belum siap: lanjut ke fallback
  }

  if (fallbackRel) {
    const fallbackVal = loadFile(PROCESSED, fallbackRel);
    if (fallbackVal) {
      // Fallback ke berkas lokal (karena tidak ada di DB) selalu dianggap fixture
      fallbackVal.fixture = true;
      cache.set(name, { value: fallbackVal, expiresAt: now + TTL_MS });
      return fallbackVal;
    }
  }
  return null;
}

export async function getZones() {
  let z = await loadArtifact('zones', 'zones.geojson');
  if (!z || !z.data || !z.data.features || z.data.features.length === 0) {
    const z1 = loadFile(GEO, 'Z-01.geojson');
    const z2 = loadFile(GEO, 'Z-02.geojson');
    if (z1 && z2) {
      const f1 = z1.features ? z1.features[0] : z1;
      const f2 = z2.features ? z2.features[0] : z2;
      f1.properties = { zone_id: 'Z-01', name: 'Teluk Banten & Selat Sunda Utara (Area Atas)', ...f1.properties };
      f2.properties = { zone_id: 'Z-02', name: 'Selat Sunda Selatan & Banten Selatan (Area Bawah)', ...f2.properties };
      z = { data: { type: 'FeatureCollection', features: [f1, f2] }, fixture: false };
    }
  }
  return z;
}
export const getEcosystem = () => loadArtifact('ecosystem', 'ecosystem.geojson');
export const getForecast = (zoneId) => (isZoneId(zoneId) ? loadArtifact(`forecast:${zoneId}`, `forecast_${zoneId}.json`) : null);
export const getGrid = (v, month) =>
  GRID_VARS.includes(v) && isMonth(month) ? loadArtifact(`grid:${v}:${month}`, `grids/${v}_${month}.json`) : null;
export const getAbundance = (month) => (isMonth(month) ? loadArtifact(`abundance:${month}`, `grids/abundance_${month}.json`) : null);

// Prakiraan harian: tanpa fallback fixture (tidak ada fixture harian; frontend jatuh ke grid bulanan).
export const getOceanWindow = () => loadArtifact('ocean_window', null);
export const getDgrid = (v, date) => {
  if (v === 'bathymetry') return loadArtifact('grid:bathymetry', 'grids/bathymetry.json');
  return GRID_VARS.includes(v) && isDate(date) ? loadArtifact(`dgrid:${v}:${date}`, null) : null;
};

export async function getLand() {
  const hit = cache.get('land');
  if (hit && Date.now() < hit.expiresAt) return hit.value;
  let val = loadFile(GEO, 'indonesia.geojson');
  if (!val) val = loadFile(GEO, 'land.geojson');
  if (val) cache.set('land', { value: val, expiresAt: Date.now() + TTL_MS });
  return val;
}

export async function getConservation() {
  const hit = cache.get('conservation');
  if (hit && Date.now() < hit.expiresAt) return hit.value;
  let val = loadFile(GEO, 'wilayah-konservasi.geojson');
  if (val) cache.set('conservation', { value: val, expiresAt: Date.now() + TTL_MS });
  return val;
}

export async function meta() {
  const z = await getZones();
  const p = z?.data?.features?.[0]?.properties;
  if (!p) return null;
  return {
    month: p.month,
    model_version: p.model_version,
    generated_at: p.generated_at,
    zone_count: z.data.features.length,
    is_fixture: z.fixture
  };
}
