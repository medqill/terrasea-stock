import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import xlsx from 'xlsx';
import { db } from '../src/db.js';
import {
  validateOceanRow,
  validateCatchRow,
  validateCatchSpeciesRow,
  validateEffortRow
} from '../src/ingest-schema.js';

// Parse command line arguments
const args = process.argv.slice(2);
let dir = 'data/raw';
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir' && args[i + 1]) {
    dir = args[i + 1];
    i++;
  } else if (args[i] === '--dry-run') {
    dryRun = true;
  }
}

// Fallback jika dir default tidak ada atau kosong
if (!fs.existsSync(dir) || fs.readdirSync(dir).length === 0) {
  const alt = path.join('data', 'unprocessed data');
  if (fs.existsSync(alt)) {
    dir = alt;
  }
}

console.log(`Mengimpor observasi dari: ${dir} ${dryRun ? '(DRY RUN)' : ''}`);

const pad = (n) => String(n).padStart(2, '0');

function parseDate(v) {
  if (typeof v === 'number') {
    const p = xlsx.SSF.parse_date_code(v);
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }
  if (v instanceof Date) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === 'string') {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

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

function findFile(baseDir, pattern) {
  function search(cur) {
    if (!fs.existsSync(cur)) return null;
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        const found = search(full);
        if (found) return found;
      } else if (pattern.test(e.name)) {
        return full;
      }
    }
    return null;
  }
  return search(baseDir);
}

const errors = [];
const stats = {
  stations: { inserted: 0, updated: 0, skipped: 0 },
  obs_ocean: { inserted: 0, updated: 0, skipped: 0 },
  obs_catch: { inserted: 0, updated: 0, skipped: 0 },
  obs_catch_species: { inserted: 0, updated: 0, skipped: 0 },
  obs_effort: { inserted: 0, updated: 0, skipped: 0 }
};

async function executeBatches(statements) {
  if (dryRun || statements.length === 0) return;
  const BATCH_SIZE = 500;
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const slice = statements.slice(i, i + BATCH_SIZE);
    await db.tx(slice);
  }
}

// -------------------------------------------------------------
// 1. Oseanografi (data_log_titik_1..6.xlsx)
// -------------------------------------------------------------
const stationStatements = [];
const oceanStatements = [];
const nowIso = new Date().toISOString();

// Ambil data existing untuk statistik inserted vs updated
const existingStations = new Set((await db.query('SELECT id FROM stations')).map((r) => r.id));
const existingOcean = new Set((await db.query("SELECT station_id || '_' || date as k FROM obs_ocean")).map((r) => r.k));

for (let i = 1; i <= 6; i++) {
  const filePath = findFile(dir, new RegExp(`data_log_titik_${i}\\.xlsx$`, 'i'));
  if (!filePath) {
    errors.push(`Berkas oseanografi titik ${i} tidak ditemukan di ${dir}`);
    continue;
  }
  const wb = xlsx.readFile(filePath);
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  if (rows.length === 0) continue;

  const stationId = `T${i}`;
  const lon = Number(rows[0].longitude);
  const lat = Number(rows[0].latitude);

  if (existingStations.has(stationId)) stats.stations.updated++;
  else stats.stations.inserted++;

  stationStatements.push({
    sql: `INSERT INTO stations(id, lon, lat) VALUES (?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET lon=excluded.lon, lat=excluded.lat`,
    args: [stationId, lon, lat]
  });

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const r = rows[rIdx];
    const chlRaw = r['Chlorophyll-a (mg m-3)'];
    const sstRaw = r['SST (degC)'];
    const uoRaw = r['uo'];
    const voRaw = r['vo'];

    // Baris yang semua nilainya kosong dilewati
    const allEmpty =
      (chlRaw === '' || chlRaw == null) &&
      (sstRaw === '' || sstRaw == null) &&
      (uoRaw === '' || uoRaw == null) &&
      (voRaw === '' || voRaw == null);

    if (allEmpty) {
      stats.obs_ocean.skipped++;
      continue;
    }

    const d = parseDate(r.time);
    const chl = chlRaw === '' || chlRaw == null ? null : Number(chlRaw);
    const sst = sstRaw === '' || sstRaw == null ? null : Number(sstRaw);
    const uo = uoRaw === '' || uoRaw == null ? null : Number(uoRaw);
    const vo = voRaw === '' || voRaw == null ? null : Number(voRaw);

    const oceanRow = { station_id: stationId, date: d, chl, sst, uo, vo };
    const val = validateOceanRow(oceanRow, `${path.basename(filePath)} baris ${rIdx + 2}`);
    if (!val.valid) {
      errors.push(...val.errors);
      continue;
    }

    const key = `${stationId}_${d}`;
    if (existingOcean.has(key)) stats.obs_ocean.updated++;
    else stats.obs_ocean.inserted++;

    oceanStatements.push({
      sql: `INSERT INTO obs_ocean(station_id, date, chl, sst, uo, vo, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(station_id, date) DO UPDATE SET
              chl=excluded.chl, sst=excluded.sst, uo=excluded.uo, vo=excluded.vo, updated_at=excluded.updated_at`,
      args: [stationId, d, chl, sst, uo, vo, nowIso, nowIso]
    });
  }
}

// -------------------------------------------------------------
// 2. Tangkapan per Kelompok Ikan (Karangantu & Lebak)
// -------------------------------------------------------------
const catchStatements = [];
const existingCatch = new Set((await db.query("SELECT region || '_' || month || '_' || fish_group as k FROM obs_catch")).map((r) => r.k));

const GROUP_MAP = {
  'pelagis besar': 'pelagis_besar',
  'pelagis kecil': 'pelagis_kecil',
  demersal: 'demersal'
};

function processCatchFile(filePath, region, sheetName) {
  if (!filePath) {
    errors.push(`Berkas tangkapan untuk region ${region} tidak ditemukan di ${dir}`);
    return;
  }
  const wb = xlsx.readFile(filePath);
  const sheet = sheetName ? wb.Sheets[sheetName] : wb.Sheets[wb.SheetNames[0]];
  if (!sheet) {
    errors.push(`Sheet ${sheetName} tidak ditemukan di ${filePath}`);
    return;
  }
  const rows = xlsx.utils.sheet_to_json(sheet);
  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const r = rows[rIdx];
    if (!r.periode || !r.kelompok) {
      stats.obs_catch.skipped++;
      continue;
    }
    const month = parseMonth(r.periode);
    const rawGroup = String(r.kelompok).trim().toLowerCase();
    const fishGroup = GROUP_MAP[rawGroup];
    const catchKg = Number(r.catch_kg);

    const catchRow = { region, month, fish_group: fishGroup, catch_kg: catchKg };
    const val = validateCatchRow(catchRow, `${path.basename(filePath)} baris ${rIdx + 2}`);
    if (!val.valid) {
      errors.push(...val.errors);
      continue;
    }

    const key = `${region}_${month}_${fishGroup}`;
    if (existingCatch.has(key)) stats.obs_catch.updated++;
    else stats.obs_catch.inserted++;

    catchStatements.push({
      sql: `INSERT INTO obs_catch(region, month, fish_group, catch_kg, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(region, month, fish_group) DO UPDATE SET
              catch_kg=excluded.catch_kg, updated_at=excluded.updated_at`,
      args: [region, month, fishGroup, catchKg, nowIso, nowIso]
    });
  }
}

const fileKarangantuCatch = findFile(dir, /Clean_Karangantu.*2021-2026\.xlsx$/i);
processCatchFile(fileKarangantuCatch, 'karangantu', 'Sheet1');

const fileLebakCatch = findFile(dir, /Clean_lebak.*\.xlsx$/i);
processCatchFile(fileLebakCatch, 'lebak');

// -------------------------------------------------------------
// 3. Tangkapan per Spesies (Karangantu Catch_Bulanan)
// -------------------------------------------------------------
const speciesStatements = [];
const effortStatements = [];
const existingSpecies = new Set((await db.query("SELECT region || '_' || month || '_' || species as k FROM obs_catch_species")).map((r) => r.k));
const existingEffort = new Set((await db.query("SELECT region || '_' || month || '_' || gear as k FROM obs_effort")).map((r) => r.k));

const SPECIES_COLUMNS = {
  'Tongkol abu-abu': 'tongkol_abu_abu',
  Tenggiri: 'tenggiri',
  Teri: 'teri',
  Kembung: 'kembung',
  Peperek: 'peperek',
  Kuniran: 'kuniran'
};

const fileEffortCatchKarangantu = findFile(dir, /Data_ML_Effort_Karangantu\.xlsx$/i);
if (!fileEffortCatchKarangantu) {
  errors.push(`Berkas Data_ML_Effort_Karangantu.xlsx tidak ditemukan di ${dir}`);
} else {
  const wb = xlsx.readFile(fileEffortCatchKarangantu);
  const sheetCatch = wb.Sheets['Catch_Bulanan'];
  if (sheetCatch) {
    const rows = xlsx.utils.sheet_to_json(sheetCatch);
    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const r = rows[rIdx];
      if (!r.tahun) {
        stats.obs_catch_species.skipped++;
        continue;
      }
      const month = parseMonth(r.periode);
      for (const [colName, speciesSlug] of Object.entries(SPECIES_COLUMNS)) {
        const valRaw = r[colName];
        const catchKg = valRaw === '' || valRaw == null ? null : Number(valRaw);

        const spRow = { region: 'karangantu', month, species: speciesSlug, catch_kg: catchKg };
        const val = validateCatchSpeciesRow(spRow, `Catch_Bulanan baris ${rIdx + 2}`);
        if (!val.valid) {
          errors.push(...val.errors);
          continue;
        }

        const key = `karangantu_${month}_${speciesSlug}`;
        if (existingSpecies.has(key)) stats.obs_catch_species.updated++;
        else stats.obs_catch_species.inserted++;

        speciesStatements.push({
          sql: `INSERT INTO obs_catch_species(region, month, species, catch_kg, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(region, month, species) DO UPDATE SET
                  catch_kg=excluded.catch_kg, updated_at=excluded.updated_at`,
          args: ['karangantu', month, speciesSlug, catchKg, nowIso, nowIso]
        });
      }
    }
  }

  // -------------------------------------------------------------
  // 4. Effort Karangantu (Effort_Alat)
  // -------------------------------------------------------------
  const sheetEffort = wb.Sheets['Effort_Alat'];
  if (sheetEffort) {
    const rows = xlsx.utils.sheet_to_json(sheetEffort);

    const GEAR_COLUMNS = {
      'Jaring Insang Tetap': 'jaring_insang_tetap',
      'Jaring Hela Dasar': 'jaring_hela_dasar',
      'Bagan Tancap': 'bagan_tancap',
      'Bagan Berperahu': 'bagan_berperahu',
      'Jaring Payang': 'jaring_payang',
      Pancing: 'pancing',
      'Jaring Insang Hanyut': 'jaring_insang_hanyut',
      Bubu: 'bubu',
      'Lain-lain': 'lain_lain'
    };

    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const r = rows[rIdx];
      if (!r.tahun) {
        stats.obs_effort.skipped++;
        continue;
      }
      const month = parseMonth(r.periode);
      let sumGears = 0;

      for (const [colName, gearSlug] of Object.entries(GEAR_COLUMNS)) {
        const valRaw = r[colName];
        const trips = valRaw === '' || valRaw == null ? null : Math.round(Number(valRaw));
        if (trips != null) sumGears += trips;

        const effRow = { region: 'karangantu', month, gear: gearSlug, trips };
        const val = validateEffortRow(effRow, `Effort_Alat baris ${rIdx + 2}`);
        if (!val.valid) {
          errors.push(...val.errors);
          continue;
        }

        const key = `karangantu_${month}_${gearSlug}`;
        if (existingEffort.has(key)) stats.obs_effort.updated++;
        else stats.obs_effort.inserted++;

        effortStatements.push({
          sql: `INSERT INTO obs_effort(region, month, gear, trips, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(region, month, gear) DO UPDATE SET
                  trips=excluded.trips, updated_at=excluded.updated_at`,
          args: ['karangantu', month, gearSlug, trips, nowIso, nowIso]
        });
      }

      // Verifikasi kolom Total semua alat
      const totalAllRaw = r['Total semua alat'];
      if (totalAllRaw != null && Number(totalAllRaw) !== sumGears) {
        console.warn(`[PERINGATAN] Effort Karangantu ${month}: jumlah alat (${sumGears}) !== 'Total semua alat' (${totalAllRaw})`);
      }
    }
  }
}

// -------------------------------------------------------------
// 5. Effort Lebak (Data_ML_Effort_Gabungan.xlsx atau data_ML_effort_lebak.xlsx)
// -------------------------------------------------------------
const fileEffortGabungan = findFile(dir, /Data_ML_Effort_Gabungan\.xlsx$/i);
const fileEffortLebakLegacy = findFile(dir, /data_ML_effort_lebak\.xlsx$/i);

if (fileEffortGabungan) {
  const wb = xlsx.readFile(fileEffortGabungan);
  const sheet = wb.Sheets['Data_Effort_ML'] || wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet);

  const GEAR_MAP = {
    'pukat cincin': 'pukat_cincin',
    'payang': 'payang',
    'jaring insang tetap': 'jaring_insang_tetap',
    'jaring insang hanyut': 'jaring_insang_hanyut',
    'trammel net': 'trammel_net',
    'rawai': 'rawai',
    'pancing': 'pancing',
    'lainnya': 'lainnya',
    'total semua alat': 'total',
    'total': 'total'
  };

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const r = rows[rIdx];
    if (!r.lokasi || String(r.lokasi).trim().toLowerCase() !== 'lebak') continue;
    if (!r.periode || !r.unit) continue;

    const month = parseMonth(r.periode);
    const unitClean = String(r.unit).trim().toLowerCase();
    const gearSlug = GEAR_MAP[unitClean] || unitClean.replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    const trips = r.trip == null ? null : Math.round(Number(r.trip));

    const effRow = { region: 'lebak', month, gear: gearSlug, trips };
    const val = validateEffortRow(effRow, `Effort Lebak baris ${rIdx + 2}`);
    if (!val.valid) {
      errors.push(...val.errors);
      continue;
    }

    const key = `lebak_${month}_${gearSlug}`;
    if (existingEffort.has(key)) stats.obs_effort.updated++;
    else stats.obs_effort.inserted++;

    effortStatements.push({
      sql: `INSERT INTO obs_effort(region, month, gear, trips, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(region, month, gear) DO UPDATE SET
              trips=excluded.trips, updated_at=excluded.updated_at`,
      args: ['lebak', month, gearSlug, trips, nowIso, nowIso]
    });
  }
} else if (fileEffortLebakLegacy) {
  const wb = xlsx.readFile(fileEffortLebakLegacy);
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const r = rows[rIdx];
    if (!r.tahun && !r.periode) {
      stats.obs_effort.skipped++;
      continue;
    }
    const month = parseMonth(r.periode);
    const trips = r['Total semua alat'] == null ? null : Math.round(Number(r['Total semua alat']));

    const effRow = { region: 'lebak', month, gear: 'total', trips };
    const val = validateEffortRow(effRow, `Effort Lebak baris ${rIdx + 2}`);
    if (!val.valid) {
      errors.push(...val.errors);
      continue;
    }

    const key = `lebak_${month}_total`;
    if (existingEffort.has(key)) stats.obs_effort.updated++;
    else stats.obs_effort.inserted++;

    effortStatements.push({
      sql: `INSERT INTO obs_effort(region, month, gear, trips, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(region, month, gear) DO UPDATE SET
              trips=excluded.trips, updated_at=excluded.updated_at`,
      args: ['lebak', month, 'total', trips, nowIso, nowIso]
    });
  }
} else {
  errors.push(`Berkas effort Lebak tidak ditemukan di ${dir}`);
}

// -------------------------------------------------------------
// Pemeriksaan Error & Eksekusi Batch
// -------------------------------------------------------------
if (errors.length > 0) {
  console.error('\n=== GAGAL: Terdeteksi baris tidak valid ===');
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log('\nMenjalankan batch upsert ke database...');
await executeBatches(stationStatements);
await executeBatches(oceanStatements);
await executeBatches(catchStatements);
await executeBatches(speciesStatements);
await executeBatches(effortStatements);

console.log('\n=== Laporan Impor Data Observasi ===');
console.log('stations          :', `dimasukkan=${stats.stations.inserted}, diperbarui=${stats.stations.updated}, dilewati=${stats.stations.skipped}`);
console.log('obs_ocean         :', `dimasukkan=${stats.obs_ocean.inserted}, diperbarui=${stats.obs_ocean.updated}, dilewati=${stats.obs_ocean.skipped}`);
console.log('obs_catch         :', `dimasukkan=${stats.obs_catch.inserted}, diperbarui=${stats.obs_catch.updated}, dilewati=${stats.obs_catch.skipped}`);
console.log('obs_catch_species :', `dimasukkan=${stats.obs_catch_species.inserted}, diperbarui=${stats.obs_catch_species.updated}, dilewati=${stats.obs_catch_species.skipped}`);
console.log('obs_effort        :', `dimasukkan=${stats.obs_effort.inserted}, diperbarui=${stats.obs_effort.updated}, dilewati=${stats.obs_effort.skipped}`);
console.log('Selesai dengan sukses.');
