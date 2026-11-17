import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import xlsx from 'xlsx';
import { createClient } from '@libsql/client';
import { runMigrations } from '../src/migrate.js';
import {
  validateOceanRow,
  validateCatchRow,
  validateCatchSpeciesRow,
  validateEffortRow
} from '../src/ingest-schema.js';

const testDbPath = 'file:data/test_import.db';
const testDir = 'data/test_import_raw';

let client;

before(async () => {
  if (fs.existsSync('data/test_import.db')) fs.unlinkSync('data/test_import.db');
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
  fs.mkdirSync(testDir, { recursive: true });

  client = createClient({ url: testDbPath });
  await runMigrations(client);
});

after(() => {
  try {
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
    if (fs.existsSync('data/test_import.db')) fs.unlinkSync('data/test_import.db');
  } catch {
    // abaikan jika file masih terkunci
  }
});

test('ingest-schema: validasi batas ocean, catch, species, dan effort', () => {
  // Ocean
  assert.ok(validateOceanRow({ station_id: 'T1', date: '2023-01-01', sst: 28, chl: 1.2, uo: 0.1, vo: -0.2 }).valid);
  assert.ok(!validateOceanRow({ station_id: 'T1', date: '2099-01-01', sst: 28 }).valid, 'tanggal masa depan ditolak');
  assert.ok(!validateOceanRow({ station_id: 'T1', date: '2023-01-01', sst: 50 }).valid, 'sst > 35 ditolak');

  // Catch
  assert.ok(validateCatchRow({ region: 'karangantu', month: '2023-01', fish_group: 'demersal', catch_kg: 100 }).valid);
  assert.ok(!validateCatchRow({ region: 'antah_berantah', month: '2023-01', fish_group: 'demersal', catch_kg: 100 }).valid);
  assert.ok(!validateCatchRow({ region: 'karangantu', month: '2023-01', fish_group: 'hiu', catch_kg: 100 }).valid);
  assert.ok(!validateCatchRow({ region: 'karangantu', month: '2023-01', fish_group: 'demersal', catch_kg: -10 }).valid);

  // Species
  assert.ok(validateCatchSpeciesRow({ region: 'karangantu', month: '2023-01', species: 'tongkol_abu_abu', catch_kg: 50 }).valid);
  assert.ok(!validateCatchSpeciesRow({ region: 'karangantu', month: '2023-01', species: 'Tongkol Spasi', catch_kg: 50 }).valid);

  // Effort
  assert.ok(validateEffortRow({ region: 'lebak', month: '2023-01', gear: 'total', trips: 100 }).valid);
  assert.ok(!validateEffortRow({ region: 'lebak', month: '2023-01', gear: 'total', trips: -1 }).valid);
  assert.ok(!validateEffortRow({ region: 'lebak', month: '2023-01', gear: 'total', trips: 12.5 }).valid);
});

test('impor observasi: normalisasi periode campuran, skip baris semua-kosong, dan idempoten tanpa duplikasi', async () => {
  // Buat file Excel mini di testDir
  // 1. data_log_titik_1.xlsx
  const oceanWb = xlsx.utils.book_new();
  const oceanRows = [
    { time: 44501, longitude: 106.1, latitude: -7.2, 'Chlorophyll-a (mg m-3)': 0.5, 'SST (degC)': 28.5, uo: 0.1, vo: -0.1, 'Current Speed (m/s)': 0.2 },
    // Baris semua nilainya kosong (harus dilewati)
    { time: 44502, longitude: 106.1, latitude: -7.2, 'Chlorophyll-a (mg m-3)': '', 'SST (degC)': null, uo: '', vo: '' },
    // Baris kedua dengan tanggal teks
    { time: '2023-05-15', longitude: 106.1, latitude: -7.2, 'Chlorophyll-a (mg m-3)': 0.8, 'SST (degC)': 29.0, uo: 0.2, vo: -0.1 }
  ];
  xlsx.utils.book_append_sheet(oceanWb, xlsx.utils.json_to_sheet(oceanRows), 'Sheet1');
  xlsx.writeFile(oceanWb, path.join(testDir, 'data_log_titik_1.xlsx'));

  // 2. Clean_Karangantu 2021-2026.xlsx dengan periode campuran (serial number dan teks)
  const catchWb = xlsx.utils.book_new();
  const catchRows = [
    { periode: 44197, kelompok: 'Pelagis besar', catch_kg: 1000 },
    { periode: '2023-06', kelompok: 'Demersal', catch_kg: 2500 }
  ];
  xlsx.utils.book_append_sheet(catchWb, xlsx.utils.json_to_sheet(catchRows), 'Sheet1');
  xlsx.writeFile(catchWb, path.join(testDir, 'Clean_Karangantu 2021-2026.xlsx'));

  // Lakukan simulasi parser dan batch insert
  const pad = (n) => String(n).padStart(2, '0');
  function parseMonth(v) {
    if (typeof v === 'number') {
      const p = xlsx.SSF.parse_date_code(v);
      return `${p.y}-${pad(p.m)}`;
    }
    if (typeof v === 'string') {
      const m = v.match(/^(\d{4})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}`;
    }
    return null;
  }

  // Verifikasi normalisasi periode
  assert.equal(parseMonth(44197), '2021-01');
  assert.equal(parseMonth('2023-06'), '2023-06');

  // Insert stasiun T1
  await client.execute({
    sql: 'INSERT INTO stations(id, lon, lat) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET lon=excluded.lon, lat=excluded.lat',
    args: ['T1', 106.1, -7.2]
  });

  // Fungsi mini import untuk test
  async function runMiniImport() {
    // Baca ocean file
    const wb = xlsx.readFile(path.join(testDir, 'data_log_titik_1.xlsx'));
    const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    for (const r of rows) {
      const chl = r['Chlorophyll-a (mg m-3)'];
      const sst = r['SST (degC)'];
      const uo = r['uo'];
      const vo = r['vo'];
      const allEmpty = (chl === '' || chl == null) && (sst === '' || sst == null) && (uo === '' || uo == null) && (vo === '' || vo == null);
      if (allEmpty) continue; // skip baris kosong

      let d;
      if (typeof r.time === 'number') {
        const p = xlsx.SSF.parse_date_code(r.time);
        d = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
      } else {
        d = r.time;
      }

      await client.execute({
        sql: `INSERT INTO obs_ocean(station_id, date, chl, sst, uo, vo, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
              ON CONFLICT(station_id, date) DO UPDATE SET
                chl=excluded.chl, sst=excluded.sst, uo=excluded.uo, vo=excluded.vo, updated_at=excluded.updated_at`,
        args: ['T1', d, Number(chl) || null, Number(sst) || null, Number(uo) || null, Number(vo) || null]
      });
    }

    // Baca catch file
    const cWb = xlsx.readFile(path.join(testDir, 'Clean_Karangantu 2021-2026.xlsx'));
    const cRows = xlsx.utils.sheet_to_json(cWb.Sheets['Sheet1']);
    for (const r of cRows) {
      const month = parseMonth(r.periode);
      const group = r.kelompok === 'Pelagis besar' ? 'pelagis_besar' : 'demersal';
      await client.execute({
        sql: `INSERT INTO obs_catch(region, month, fish_group, catch_kg, created_at, updated_at)
              VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
              ON CONFLICT(region, month, fish_group) DO UPDATE SET
                catch_kg=excluded.catch_kg, updated_at=excluded.updated_at`,
        args: ['karangantu', month, group, Number(r.catch_kg)]
      });
    }
  }

  // Jalankan impor pertama
  await runMiniImport();

  const oceanRes1 = await client.execute('SELECT COUNT(*) as c FROM obs_ocean');
  const catchRes1 = await client.execute('SELECT COUNT(*) as c FROM obs_catch');

  // Baris kosong dilewati sehingga hanya 2 baris oseanografi yang masuk
  assert.equal(Number(oceanRes1.rows[0].c), 2);
  assert.equal(Number(catchRes1.rows[0].c), 2);

  // Jalankan impor kedua kali (uji idempotensi)
  await runMiniImport();

  const oceanRes2 = await client.execute('SELECT COUNT(*) as c FROM obs_ocean');
  const catchRes2 = await client.execute('SELECT COUNT(*) as c FROM obs_catch');

  // Jumlah baris tidak boleh bertambah (tidak duplikat)
  assert.equal(Number(oceanRes2.rows[0].c), 2);
  assert.equal(Number(catchRes2.rows[0].c), 2);
});

