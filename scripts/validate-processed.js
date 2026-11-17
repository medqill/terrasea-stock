// Validasi skema data contract (ARCHITECTURE bagian 5, PIPELINE_CONTRACT) dan batas keras AGENTS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtifact } from '../src/contract.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'processed');
const errors = [];
const fail = (m) => errors.push(m);
const find = (name) => [path.basename(name), `fixture_${path.basename(name)}`].map((n) => path.join(dir, path.dirname(name), n)).find((p) => fs.existsSync(p));
const read = (name) => { const p = find(name); if (!p) { fail(`Berkas tidak ada: ${name}`); return null; } return JSON.parse(fs.readFileSync(p, 'utf8')); };
const GROUPS = ['pelagis_besar', 'pelagis_kecil', 'demersal'];
const need = (obj, keys, where) => keys.forEach((k) => { if (obj?.[k] === undefined || obj?.[k] === null) fail(`${where}: field "${k}" wajib ada`); });

const zones = read('zones.geojson');
const ids = [];
if (zones) {
  const n = zones.features.length;
  if (n < 2 || n > 7) fail(`zones: jumlah zona ${n}, harus 2-7`);
  for (const f of zones.features) {
    const p = f.properties, w = `zones ${p.zone_id}`;
    ids.push(p.zone_id);
    need(p, ['zone_id', 'name', 'area_ha', 'touches_coast', 'month', 'msy', 'tac', 'abundance', 'season', 'model_version', 'generated_at'], w);
    if (!(p.area_ha > 0)) fail(`${w}: area_ha ${p.area_ha} harus > 0`);
    if (p.touches_coast !== true) fail(`${w}: touches_coast harus true`);
    for (const g of [...GROUPS, 'total']) {
      if (!(p.msy?.[g] >= 0)) fail(`${w}: msy.${g} tidak valid`);
      if (!(p.tac?.[g] >= 0)) fail(`${w}: tac.${g} tidak valid`);
    }
    for (const g of GROUPS) if (!['high', 'mid', 'low'].includes(p.abundance?.[g])) fail(`${w}: abundance.${g} harus high|mid|low`);
  }
}
const eco = read('ecosystem.geojson');
eco?.features.forEach((f, i) => { if (!['coral', 'seagrass'].includes(f.properties.type)) fail(`ecosystem #${i}: type harus coral|seagrass`); });

for (const id of ids) {
  const f = read(`forecast_${id}.json`);
  if (!f) continue;
  need(f, ['zone_id', 'model_version', 'generated_at', 'metrics', 'series', 'params'], `forecast ${id}`);
  need(f.metrics, ['rmse', 'mae', 'n_test'], `forecast ${id}.metrics`);
  for (const s of f.series) {
    if (!['hindcast', 'forecast'].includes(s.kind)) fail(`forecast ${id} ${s.month}: kind tidak valid`);
    for (const v of [s.hindcast, s.msy, s.actual_catch]) if (v !== null && v !== undefined && v < 0) fail(`forecast ${id} ${s.month}: nilai negatif`);
  }
  if (!f.series.some((s) => s.kind === 'forecast')) fail(`forecast ${id}: tidak ada baris forecast`);
}

const month = zones?.features[0]?.properties.month;
for (const v of ['sst', 'chl', 'current']) {
  const g = read(`grids/${v}_${month}.json`);
  if (!g) continue;
  if (g.values.length !== g.nx * g.ny) fail(`grid ${v}: panjang values != nx*ny`);
  need(g, ['bbox', 'unit', 'vmin', 'vmax'], `grid ${v}`);
}
const ab = read(`grids/abundance_${month}.json`);
if (ab) for (const g of GROUPS) if (ab.groups?.[g]?.length !== ab.nx * ab.ny) fail(`abundance ${g}: panjang tidak cocok`);

// ---- Prakiraan harian: dgrid_{var}_{YYYY-MM-DD}.json dan ocean_window.json ----
// Aturan isi ada di src/contract.js (satu sumber kebenaran, dipakai juga oleh PUT /api/ingest/artifacts).
const dgridPattern = /^dgrid_(sst|chl|current)_(\d{4}-\d{2}-\d{2})\.json$/;
const dgridFiles = new Set();
for (const rel of fs.readdirSync(dir, { recursive: true })) {
  const m = dgridPattern.exec(path.basename(String(rel)));
  if (!m) continue;
  dgridFiles.add(path.basename(String(rel)));
  let content;
  try { content = JSON.parse(fs.readFileSync(path.join(dir, String(rel)), 'utf8')); } catch { fail(`dgrid tidak dapat diparse: ${rel}`); continue; }
  const res = validateArtifact(`dgrid:${m[1]}:${m[2]}`, content);
  if (!res.valid) res.errors.forEach((e) => fail(e));
}

const owPath = find('ocean_window.json');
if (owPath) {
  const ow = JSON.parse(fs.readFileSync(owPath, 'utf8'));
  const res = validateArtifact('ocean_window', ow);
  if (!res.valid) res.errors.forEach((e) => fail(e));
  else {
    for (const d of ow.days) for (const v of ['sst', 'chl', 'current']) {
      if (!dgridFiles.has(`dgrid_${v}_${d.date}.json`)) fail(`ocean_window: grid dgrid_${v}_${d.date}.json tidak ada`);
    }
  }
}

const fixtures = fs.readdirSync(dir, { recursive: true }).filter((n) => String(n).includes('fixture_')).length;
if (errors.length) { console.error(`GAGAL (${errors.length}):\n- ` + errors.join('\n- ')); process.exit(1); }
console.log(`OK: skema valid${fixtures ? ` (${fixtures} berkas masih fixture)` : ''}${owPath ? `, ${dgridFiles.size} grid harian` : ''}.`);