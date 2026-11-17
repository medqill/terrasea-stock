import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import xlsx from 'xlsx';
import { db } from '../src/db.js';
import { validateCatchRow, validateEffortRow } from '../src/ingest-schema.js';

const pad = (n) => String(n).padStart(2, '0');

function parseMonth(v) {
  if (typeof v === 'number') {
    const p = xlsx.SSF.parse_date_code(v);
    return `${p.y}-${pad(p.m)}`;
  }
  if (v instanceof Date) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}`;
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;
  }
  return null;
}

const GROUP_MAP = {
  'pelagis besar': 'pelagis_besar',
  'pelagis kecil': 'pelagis_kecil',
  demersal: 'demersal'
};

const GEAR_MAP = {
  'pukat cincin': 'pukat_cincin',
  'payang': 'payang',
  'jaring insang tetap': 'jaring_insang_tetap',
  'jaring insang hanyut': 'jaring_insang_hanyut',
  'trammel net': 'trammel_net',
  'rawai': 'rawai',
  'pancing': 'pancing',
  'lainnya': 'lainnya',
  'lain-lain': 'lain_lain',
  'total semua alat': 'total',
  'total': 'total'
};

function slugifyGear(unit) {
  const clean = String(unit).trim().toLowerCase();
  return GEAR_MAP[clean] || clean.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

async function executeBatches(statements, batchSize = 500) {
  for (let i = 0; i < statements.length; i += batchSize) {
    const slice = statements.slice(i, i + batchSize);
    await db.tx(slice);
  }
}

async function run() {
  console.log('=== PENGGANTIAN DATA LEBAK (TANGKAPAN & EFFORT) ===');

  // 1. Drop semua data lama Lebak dari obs_catch dan obs_effort
  console.log('Menghapus data lama Lebak dari tabel obs_catch dan obs_effort...');
  const delCatch = await db.run("DELETE FROM obs_catch WHERE region = 'lebak'");
  const delEffort = await db.run("DELETE FROM obs_effort WHERE region = 'lebak'");
  console.log(`Dihapus: ${delCatch.changes} baris obs_catch, ${delEffort.changes} baris obs_effort.`);

  const nowIso = new Date().toISOString();

  // 2. Baca Tangkapan Lebak baru
  const catchFile = path.join('data', 'unprocessed data', 'Tangkapan', 'Clean_lebak 2021-2026.xlsx');
  if (!fs.existsSync(catchFile)) {
    throw new Error(`Berkas tangkapan Lebak tidak ditemukan di: ${catchFile}`);
  }

  console.log(`Membaca data tangkapan baru dari: ${catchFile}`);
  const wbCatch = xlsx.readFile(catchFile);
  const sheetCatchName = wbCatch.SheetNames[0];
  const catchRows = xlsx.utils.sheet_to_json(wbCatch.Sheets[sheetCatchName]);

  const catchStatements = [];
  let catchValidCount = 0;

  for (let rIdx = 0; rIdx < catchRows.length; rIdx++) {
    const r = catchRows[rIdx];
    if (!r.periode || !r.kelompok) continue;

    const month = parseMonth(r.periode);
    const rawGroup = String(r.kelompok).trim().toLowerCase();
    const fishGroup = GROUP_MAP[rawGroup];
    const catchKg = Number(r.catch_kg);

    const row = { region: 'lebak', month, fish_group: fishGroup, catch_kg: catchKg };
    const val = validateCatchRow(row, `Tangkapan Lebak baris ${rIdx + 2}`);
    if (!val.valid) {
      console.warn(`[SKIP] Baris tidak valid:`, val.errors);
      continue;
    }

    catchStatements.push({
      sql: `INSERT INTO obs_catch(region, month, fish_group, catch_kg, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(region, month, fish_group) DO UPDATE SET
              catch_kg=excluded.catch_kg, updated_at=excluded.updated_at`,
      args: ['lebak', month, fishGroup, catchKg, nowIso, nowIso]
    });
    catchValidCount++;
  }

  console.log(`Menyimpan ${catchStatements.length} baris ke obs_catch...`);
  await executeBatches(catchStatements);

  // 3. Baca Effort Lebak baru
  const effortFile = path.join('data', 'unprocessed data', 'Tangkapan', 'Data_ML_Effort_Gabungan.xlsx');
  if (!fs.existsSync(effortFile)) {
    throw new Error(`Berkas effort gabungan tidak ditemukan di: ${effortFile}`);
  }

  console.log(`Membaca data effort baru dari: ${effortFile}`);
  const wbEffort = xlsx.readFile(effortFile);
  const sheetEffort = wbEffort.Sheets['Data_Effort_ML'] || wbEffort.Sheets[wbEffort.SheetNames[0]];
  const effortRows = xlsx.utils.sheet_to_json(sheetEffort);

  const effortStatements = [];
  let effortValidCount = 0;

  for (let rIdx = 0; rIdx < effortRows.length; rIdx++) {
    const r = effortRows[rIdx];
    if (!r.lokasi || String(r.lokasi).trim().toLowerCase() !== 'lebak') continue;
    if (!r.periode || !r.unit) continue;

    const month = parseMonth(r.periode);
    const gearSlug = slugifyGear(r.unit);
    const trips = r.trip == null ? null : Math.round(Number(r.trip));

    const row = { region: 'lebak', month, gear: gearSlug, trips };
    const val = validateEffortRow(row, `Effort Lebak baris ${rIdx + 2}`);
    if (!val.valid) {
      console.warn(`[SKIP] Baris tidak valid:`, val.errors);
      continue;
    }

    effortStatements.push({
      sql: `INSERT INTO obs_effort(region, month, gear, trips, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(region, month, gear) DO UPDATE SET
              trips=excluded.trips, updated_at=excluded.updated_at`,
      args: ['lebak', month, gearSlug, trips, nowIso, nowIso]
    });
    effortValidCount++;
  }

  console.log(`Menyimpan ${effortStatements.length} baris ke obs_effort...`);
  await executeBatches(effortStatements);

  console.log('\n=== SUKSES MEMPERBARUI DATA LEBAK ===');
  console.log(`- obs_catch Lebak  : ${catchValidCount} baris berhasil dimasukkan.`);
  console.log(`- obs_effort Lebak : ${effortValidCount} baris berhasil dimasukkan.`);
}

run().catch((err) => {
  console.error('Terjadi kesalahan:', err);
  process.exit(1);
});

