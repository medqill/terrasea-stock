// Mengisi tabel artifacts dari data/processed (baik berkas asli maupun fixture_*).
// Menjamin aplikasi web membaca data olahan dari database Turso (ARCHITECTURE Bagian 2).
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db.js';
import { validateArtifact } from '../src/contract.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'processed');

if (!fs.existsSync(root)) {
  console.error(`Folder data/processed tidak ditemukan di: ${root}`);
  process.exit(1);
}

// Kumpulkan berkas processed (prioritaskan non-fixture jika kedua versi ada)
const filesToProcess = [];

function scanDir(dir, relDir = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      scanDir(path.join(dir, entry.name), path.join(relDir, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.json') || entry.name.endsWith('.geojson')) {
      filesToProcess.push({
        fullPath: path.join(dir, entry.name),
        relPath: path.join(relDir, entry.name),
        fileName: entry.name
      });
    }
  }
}

scanDir(root);

// Prioritaskan berkas non-fixture jika kedua versi ada
const groupedFiles = new Map();
for (const file of filesToProcess) {
  const isFixture = file.fileName.startsWith('fixture_');
  const cleanName = path.join(path.dirname(file.relPath), file.fileName.replace(/^fixture_/, ''));
  const existing = groupedFiles.get(cleanName);
  if (!existing || (existing.isFixture && !isFixture)) {
    groupedFiles.set(cleanName, { ...file, isFixture });
  }
}

const finalFiles = Array.from(groupedFiles.values());
console.log(`Menemukan ${filesToProcess.length} berkas di data/processed (dipilih ${finalFiles.length} berkas prioritas).`);

const statements = [];
const summary = [];

for (const { fullPath, fileName, isFixture } of finalFiles) {
  const cleanName = fileName.replace(/^fixture_/, '');
  const rawText = fs.readFileSync(fullPath, 'utf8');
  let content;
  try {
    content = JSON.parse(rawText);
  } catch (err) {
    console.warn(`[LEWATI] Berkas ${fileName} bukan JSON valid: ${err.message}`);
    continue;
  }

  let artifactName = null;
  let month = null;
  let modelVersion = null;
  let generatedAt = null;

  if (cleanName === 'zones.geojson') {
    artifactName = 'zones';
    const firstProp = content?.features?.[0]?.properties;
    month = firstProp?.month || null;
    modelVersion = firstProp?.model_version || null;
    generatedAt = firstProp?.generated_at || null;
  } else if (cleanName === 'ecosystem.geojson') {
    artifactName = 'ecosystem';
  } else if (/^forecast_(Z-\d{2})\.json$/.test(cleanName)) {
    const match = cleanName.match(/^forecast_(Z-\d{2})\.json$/);
    artifactName = `forecast:${match[1]}`;
    modelVersion = content.model_version || null;
    generatedAt = content.generated_at || null;
  } else if (/^(sst|chl|current|bathymetry)_(\d{4}-\d{2})\.json$/.test(cleanName)) {
    const match = cleanName.match(/^(sst|chl|current|bathymetry)_(\d{4}-\d{2})\.json$/);
    artifactName = match[1] === 'bathymetry' ? 'grid:bathymetry' : `grid:${match[1]}:${match[2]}`;
    month = match[2];
  } else if (cleanName === 'bathymetry.json') {
    artifactName = 'grid:bathymetry';
    month = content.month || null;
  } else if (/^abundance_(\d{4}-\d{2})\.json$/.test(cleanName)) {
    const match = cleanName.match(/^abundance_(\d{4}-\d{2})\.json$/);
    artifactName = `abundance:${match[1]}`;
    month = match[1];
  } else if (cleanName === 'ocean_window.json') {
    artifactName = 'ocean_window';
    modelVersion = content.model_version || null;
    generatedAt = content.generated_at || null;
  } else if (/^dgrid_(sst|chl|current)_(\d{4}-\d{2}-\d{2})\.json$/.test(cleanName)) {
    const match = cleanName.match(/^dgrid_(sst|chl|current)_(\d{4}-\d{2}-\d{2})\.json$/);
    artifactName = `dgrid:${match[1]}:${match[2]}`;
    month = match[2].slice(0, 7);
    modelVersion = content.model_version || null;
    generatedAt = content.generated_at || null;
  } else {
    console.warn(`[LEWATI] Nama berkas tidak dikenali polanya: ${fileName}`);
    continue;
  }

  // Validasi kontrak sebelum seeding
  const validation = validateArtifact(artifactName, content);
  if (!validation.valid) {
    console.error(`[ERROR KONTRAK] Artifact ${artifactName} (${fileName}) tidak valid:`, validation.errors);
    process.exit(1);
  }

  statements.push({
    sql: `INSERT INTO artifacts (name, month, content, model_version, generated_at, is_fixture, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(name) DO UPDATE SET
            month=excluded.month, content=excluded.content, model_version=excluded.model_version,
            generated_at=excluded.generated_at, is_fixture=excluded.is_fixture, updated_at=datetime('now')`,
    args: [
      artifactName,
      month,
      rawText,
      modelVersion,
      generatedAt,
      isFixture ? 1 : 0
    ]
  });

  summary.push({ name: artifactName, isFixture, modelVersion, month });
}

if (statements.length === 0) {
  console.log('Tidak ada berkas yang perlu di-seed.');
  process.exit(0);
}

try {
  await db.tx(statements);
  console.log('\n=== Laporan Seed Artifacts ke Database ===');
  for (const s of summary) {
    console.log(`- ${s.name.padEnd(24)} : fixture=${s.isFixture ? 'ya' : 'tidak'}, model=${s.modelVersion || '-'}, bulan=${s.month || '-'}`);
  }
  console.log(`\nSukses: ${statements.length} artifact tersimpan di tabel "artifacts".`);
} catch (err) {
  console.error('Gagal melakukan batch seed artifacts:', err.message);
  process.exit(1);
}

