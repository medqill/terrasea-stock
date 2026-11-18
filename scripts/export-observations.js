// Mengekspor data observasi mentah dari database ke CSV di data/raw/ untuk pipeline ML (ml/*.py).
// Menambahkan stations.csv (koordinat 6 titik) yang dibutuhkan ml/05b_grids_idw.py.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
let outDir = path.join(root, 'data', 'raw');
for (let i = 0; i < args.length; i++) if (args[i] === '--out-dir' && args[i + 1]) outDir = path.resolve(args[++i]);

console.log(`Mengekspor observasi mentah${dryRun ? ' (DRY RUN)' : ''} ke: ${outDir}`);

function toCsv(rows, headers) {
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => {
      const val = r[h];
      if (val === null || val === undefined) return '';
      if (typeof val === 'string' && /[",\n]/.test(val)) return `"${val.replace(/"/g, '""')}"`;
      return String(val);
    }).join(','));
  }
  return lines.join('\n') + '\n';
}

const q = async (sql) => {
  try {
    return await db.query(sql);
  } catch (err) {
    if (err.message && err.message.includes('no such table')) return [];
    throw err;
  }
};
const oceanRows = await q('SELECT station_id, date, chl, sst, uo, vo FROM obs_ocean ORDER BY date ASC, station_id ASC');
const catchRows = await q('SELECT region, month, fish_group, catch_kg FROM obs_catch ORDER BY month ASC, region ASC, fish_group ASC');
const speciesRows = await q('SELECT region, month, species, catch_kg FROM obs_catch_species ORDER BY month ASC, region ASC, species ASC');
const effortRows = await q('SELECT region, month, gear, trips FROM obs_effort ORDER BY month ASC, region ASC, gear ASC');
const stationRows = await q('SELECT id AS station_id, lon, lat FROM stations ORDER BY id ASC');

console.log('\n=== Ringkasan Data yang Diekspor ===');
console.log(`- obs_ocean         : ${oceanRows.length} baris`);
console.log(`- obs_catch         : ${catchRows.length} baris`);
console.log(`- obs_catch_species : ${speciesRows.length} baris`);
console.log(`- obs_effort        : ${effortRows.length} baris`);
console.log(`- stations          : ${stationRows.length} baris`);
if (dryRun) { console.log('\nDRY RUN: tidak ada berkas yang ditulis.'); process.exit(0); }

fs.mkdirSync(outDir, { recursive: true });
const exports = [
  { file: 'observations_ocean.csv', headers: ['station_id', 'date', 'chl', 'sst', 'uo', 'vo'], data: oceanRows },
  { file: 'observations_catch.csv', headers: ['region', 'month', 'fish_group', 'catch_kg'], data: catchRows },
  { file: 'observations_catch_species.csv', headers: ['region', 'month', 'species', 'catch_kg'], data: speciesRows },
  { file: 'observations_effort.csv', headers: ['region', 'month', 'gear', 'trips'], data: effortRows },
  { file: 'stations.csv', headers: ['station_id', 'lon', 'lat'], data: stationRows }
];
for (const exp of exports) {
  const csv = toCsv(exp.data, exp.headers);
  fs.writeFileSync(path.join(outDir, exp.file), csv, 'utf8');
  console.log(`[TULIS] ${exp.file} (${(csv.length / 1024).toFixed(1)} KB)`);
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({
  exported_at: new Date().toISOString(),
  row_counts: { ocean: oceanRows.length, catch: catchRows.length, catch_species: speciesRows.length, effort: effortRows.length, stations: stationRows.length }
}, null, 2), 'utf8');
console.log('[TULIS] manifest.json\n\nEkspor selesai dengan sukses.');