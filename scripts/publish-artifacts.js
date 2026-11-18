// Mempublikasikan keluaran pipeline ML (data/processed/) ke tabel artifacts.
// Mode langsung (Turso, db.tx) atau via HTTP Ingest API. Sesuai ARCHITECTURE bagian 2.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db.js';
import { validateArtifact, addDays } from '../src/contract.js';
import { cleanupOldDgrids, todayJakarta } from '../src/dgrid-cleanup.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let processedDir = path.join(root, 'data', 'processed');
let apiUrl = process.env.API_URL || process.env.APP_URL || null;
let apiKey = process.env.BOT_API_KEY || process.env.INGEST_API_KEY || null;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dir' && args[i + 1]) processedDir = path.resolve(args[++i]);
  else if (args[i] === '--api-url' && args[i + 1]) apiUrl = args[++i];
  else if (args[i] === '--api-key' && args[i + 1]) apiKey = args[++i];
}

console.log(`Mempublikasikan artifact dari: ${processedDir}`);
console.log(apiUrl ? `Mode: HTTP Ingest API ke ${apiUrl}` : 'Mode: Direct Database Connection (Turso libSQL)');
if (!fs.existsSync(processedDir)) { console.error(`Direktori tidak ditemukan: ${processedDir}`); process.exit(1); }

const files = [];
(function scan(d) {
  for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    if (entry.isDirectory()) scan(path.join(d, entry.name));
    else if (entry.isFile() && /\.(geo)?json$/.test(entry.name)) files.push({ full: path.join(d, entry.name), name: entry.name });
  }
})(processedDir);

const toPublish = [];
for (const { full, name } of files) {
  const isFixture = name.startsWith('fixture_');
  const clean = name.replace(/^fixture_/, '');
  const raw = fs.readFileSync(full, 'utf8');
  let content;
  try { content = JSON.parse(raw); } catch { console.warn(`[LEWATI] Bukan JSON: ${name}`); continue; }

  let artifactName = null, month = null, modelVersion = null, generatedAt = null;
  let m;
  if (clean === 'zones.geojson') {
    artifactName = 'zones';
    const p = content?.features?.[0]?.properties;
    month = p?.month || null; modelVersion = p?.model_version || null; generatedAt = p?.generated_at || null;
  } else if (clean === 'ecosystem.geojson') {
    artifactName = 'ecosystem';
  } else if ((m = clean.match(/^forecast_(Z-\d{2})\.json$/))) {
    artifactName = `forecast:${m[1]}`; modelVersion = content.model_version || null; generatedAt = content.generated_at || null;
  } else if ((m = clean.match(/^(sst|chl|current|bathymetry)_(\d{4}-\d{2})\.json$/))) {
    artifactName = m[1] === 'bathymetry' ? 'grid:bathymetry' : `grid:${m[1]}:${m[2]}`;
    month = m[2];
  } else if (clean === 'bathymetry.json') {
    artifactName = 'grid:bathymetry';
    month = content.month || null;
  } else if ((m = clean.match(/^abundance_(\d{4}-\d{2})\.json$/))) {
    artifactName = `abundance:${m[1]}`; month = m[1];
  } else if ((m = clean.match(/^dgrid_(sst|chl|current)_(\d{4}-\d{2}-\d{2})\.json$/))) {
    artifactName = `dgrid:${m[1]}:${m[2]}`; month = m[2].slice(0, 7);
    modelVersion = content.model_version ?? null; generatedAt = content.generated_at ?? null;
  } else if (clean === 'ocean_window.json') {
    artifactName = 'ocean_window'; month = content.reference_date?.slice(0, 7) ?? null;
    modelVersion = content.model_version ?? null; generatedAt = content.generated_at ?? null;
  } else {
    continue; // mis. ocean_forecast_stations.json: perantara, tidak dipublikasikan
  }

  const v = validateArtifact(artifactName, content);
  if (!v.valid) { console.error(`[VALIDASI GAGAL] ${artifactName} (${name}):`, v.errors.join('; ')); process.exit(1); }
  toPublish.push({ name: artifactName, month, content: raw, modelVersion, generatedAt, isFixture: isFixture ? 1 : 0 });
}

if (toPublish.length === 0) { console.log('Tidak ada artifact yang ditemukan untuk dipublikasikan.'); process.exit(0); }

// ocean_window tidak boleh terbit tanpa ketujuh hari x tiga variabel gridnya.
const ow = toPublish.find((a) => a.name === 'ocean_window');
if (ow) {
  const have = new Set(toPublish.map((a) => a.name));
  const missing = [];
  for (const d of JSON.parse(ow.content).days) for (const v of ['sst', 'chl', 'current']) {
    if (!have.has(`dgrid:${v}:${d.date}`)) missing.push(`dgrid:${v}:${d.date}`);
  }
  if (missing.length) { console.error('[GAGAL] ocean_window merujuk grid yang tidak ada:', missing.join(', ')); process.exit(1); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Throttle: 50 request/menit aman (di bawah batas 60) → jedakan 1,2 detik per request
const THROTTLE_MS = 1200;

if (apiUrl && apiKey) {
  const base = apiUrl.replace(/\/$/, '');
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  console.log(`\nMengirim ${toPublish.length} artifact via API (throttle: 1 req / ${THROTTLE_MS}ms)...`);
  for (let i = 0; i < toPublish.length; i++) {
    const art = toPublish[i];
    // Throttle: tunggu sebelum request agar tidak kena 429
    if (i > 0) await sleep(THROTTLE_MS);
    let retries = 3;
    while (retries > 0) {
      const res = await fetch(`${base}/api/ingest/artifacts/${encodeURIComponent(art.name)}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ content: JSON.parse(art.content), month: art.month, model_version: art.modelVersion, generated_at: art.generatedAt, is_fixture: art.isFixture })
      });
      if (res.status === 429) {
        console.warn(`[429] ${art.name}: rate limit, menunggu 60 detik...`);
        await sleep(60_000);
        retries--;
        continue;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error(`[GAGAL] ${art.name}: HTTP ${res.status} - ${err.message || 'Error'}`);
        process.exit(1);
      }
      console.log(`[OK] ${i + 1}/${toPublish.length} ${art.name}`);
      break;
    }
  }
  if (ow) {
    // Mode API tidak punya daftar artifact: hapus jendela 15..21 hari lalu (cukup untuk pipeline harian).
    const today = todayJakarta();
    let n = 0;
    for (let back = 15; back <= 21; back++) for (const v of ['sst', 'chl', 'current']) {
      const res = await fetch(`${base}/api/ingest/artifacts/${encodeURIComponent(`dgrid:${v}:${addDays(today, -back)}`)}`, { method: 'DELETE', headers });
      if (res.ok) n++;
    }
    console.log(`Pembersihan dgrid lama: ${n} dihapus.`);
  }
} else {
  console.log(`\nMenyimpan ${toPublish.length} artifact ke database...`);
  const statements = toPublish.map((a) => ({
    sql: `INSERT INTO artifacts (name, month, content, model_version, generated_at, is_fixture, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(name) DO UPDATE SET
            month=excluded.month, content=excluded.content, model_version=excluded.model_version,
            generated_at=excluded.generated_at, is_fixture=excluded.is_fixture, updated_at=datetime('now')`,
    args: [a.name, a.month, a.content, a.modelVersion, a.generatedAt, a.isFixture]
  }));
  try {
    await db.tx(statements);
    console.log('Semua artifact berhasil disimpan ke database.');
    if (ow) console.log(`Pembersihan dgrid > 14 hari: ${await cleanupOldDgrids(db)} dihapus.`);
  } catch (err) {
    console.error('Gagal menyimpan artifact ke database:', err.message);
    process.exit(1);
  }
}
console.log(`\nPublikasi selesai. Total: ${toPublish.length} artifact.`);