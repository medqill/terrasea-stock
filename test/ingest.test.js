import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.TURSO_DATABASE_URL = 'file:data/test_ingest.db';
process.env.SESSION_SECRET = 'rahasia-uji-minimal-16-karakter';

if (fs.existsSync('data/test_ingest.db')) {
  try { fs.unlinkSync('data/test_ingest.db'); } catch {}
}

const { runMigrations } = await import('../src/migrate.js');
await runMigrations();

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

let server, base;
before(() => new Promise((ok) => {
  server = createApp().listen(0, () => {
    base = `http://127.0.0.1:${server.address().port}`;
    ok();
  });
}));

after(async () => {
  server.close();
  try {
    if (fs.existsSync('data/test_ingest.db')) fs.unlinkSync('data/test_ingest.db');
  } catch {}
});

// Helper untuk membuat API key langsung di DB
async function insertKey(name, scopes, { revoked = false } = {}) {
  const raw = `tsk_${crypto.randomBytes(24).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const res = await db.run(
    "INSERT INTO api_keys (name, key_hash, scopes, created_at, revoked_at) VALUES (?, ?, ?, datetime('now'), ?)",
    [name, hash, Array.isArray(scopes) ? scopes.join(',') : scopes, revoked ? new Date().toISOString() : null]
  );
  return { id: res.lastInsertRowid ?? res.last_insert_rowid, raw, hash };
}

// Helper login admin
async function setupAdmin() {
  const { hash, salt } = hashPassword('kata-sandi-admin-1');
  await db.run(
    "INSERT INTO users(name,email,password_hash,salt,role,status,created_at) VALUES (?,?,?,?,'admin','active',?)",
    ['Admin Ingest', 'admin.ingest@instansi.ac.id', hash, salt, new Date().toISOString()]
  );
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin.ingest@instansi.ac.id', password: 'kata-sandi-admin-1' })
  });
  const cookie = res.headers.getSetCookie()[0]?.split(';')[0];
  return { cookie };
}

test('auth API key: penolakan tanpa token, format salah, tidak dikenal, dan dicabut', async () => {
  // 1. Tanpa header
  const r1 = await fetch(`${base}/api/ingest/export`);
  assert.equal(r1.status, 401);

  // 2. Format bukan Bearer
  const r2 = await fetch(`${base}/api/ingest/export`, {
    headers: { Authorization: 'Basic dXNlcjpwYXNz' }
  });
  assert.equal(r2.status, 401);

  // 3. Format bukan tsk_
  const r3 = await fetch(`${base}/api/ingest/export`, {
    headers: { Authorization: 'Bearer random_token_123' }
  });
  assert.equal(r3.status, 401);

  // 4. Token tsk_ tetapi tidak ada di database
  const r4 = await fetch(`${base}/api/ingest/export`, {
    headers: { Authorization: 'Bearer tsk_0123456789abcdef0123456789abcdef0123456789abcdef' }
  });
  assert.equal(r4.status, 401);

  // 5. Token telah dicabut (revoked)
  const revokedKey = await insertKey('Revoked Bot', ['observations:read'], { revoked: true });
  const r5 = await fetch(`${base}/api/ingest/export`, {
    headers: { Authorization: `Bearer ${revokedKey.raw}` }
  });
  assert.equal(r5.status, 401);
});

test('auth API key: periksa scope dan pembaruan last_used_at', async () => {
  const readOnlyKey = await insertKey('Read Bot', ['observations:read']);
  const writeKey = await insertKey('Write Bot', ['observations:write']);

  // Read Bot mencoba menulis observasi -> 403 Forbidden
  const rPost = await fetch(`${base}/api/ingest/ocean`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${readOnlyKey.raw}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ rows: [] })
  });
  assert.equal(rPost.status, 403);

  // Write Bot membaca export -> 403 Forbidden
  const rGet = await fetch(`${base}/api/ingest/export`, {
    headers: { Authorization: `Bearer ${writeKey.raw}` }
  });
  assert.equal(rGet.status, 403);

  // Read Bot membaca export -> 200 OK & last_used_at terisi
  const rGetOk = await fetch(`${base}/api/ingest/export`, {
    headers: { Authorization: `Bearer ${readOnlyKey.raw}` }
  });
  assert.equal(rGetOk.status, 200);

  const keyRow = await db.one('SELECT last_used_at FROM api_keys WHERE id=?', [readOnlyKey.id]);
  assert.ok(keyRow.last_used_at, 'last_used_at harus terisi setelah request sukses');
});

test('ingest ocean: batasan payload, validasi batas nilai, dan sifat atomik batch', async () => {
  const writeKey = await insertKey('Ocean Ingest Bot', ['observations:write']);

  // Masukkan stasiun T1 terlebih dahulu
  await db.run("INSERT OR IGNORE INTO stations (id, lon, lat) VALUES ('T1', 106.15, -5.95)");

  // 1. Payload kosong
  const rEmpty = await fetch(`${base}/api/ingest/ocean`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${writeKey.raw}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: [] })
  });
  assert.equal(rEmpty.status, 400);

  // 2. Melebihi 500 baris
  const over500 = Array.from({ length: 501 }, (_, i) => ({
    station_id: 'T1',
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    sst: 28.5
  }));
  const rOver = await fetch(`${base}/api/ingest/ocean`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${writeKey.raw}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: over500 })
  });
  assert.equal(rOver.status, 400);

  // 3. Batch atomik: jika ada 1 baris tidak valid, seluruh batch harus gagal dan tidak ada yang tersimpan
  const mixedBatch = [
    { station_id: 'T1', date: '2026-02-01', sst: 29.0 },
    { station_id: 'T1', date: '2026-02-02', sst: 99.0 } // 99.0 di luar rentang sst (15-38)
  ];
  const rInvalid = await fetch(`${base}/api/ingest/ocean`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${writeKey.raw}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: mixedBatch })
  });
  assert.equal(rInvalid.status, 400);

  // Verifikasi baris pertama TIDAK tersimpan
  const checkRow = await db.one("SELECT * FROM obs_ocean WHERE station_id='T1' AND date='2026-02-01'");
  assert.equal(checkRow, null, 'Batch harus atomik: tidak boleh ada baris parsial yang masuk');

  // 4. Batch valid: sukses disimpan
  const validBatch = [
    { station_id: 'T1', date: '2026-02-01', chl: 0.85, sst: 29.2, uo: 0.12, vo: -0.05 },
    { station_id: 'T1', date: '2026-02-02', chl: 0.90, sst: 29.4, uo: 0.10, vo: -0.02 }
  ];
  const rValid = await fetch(`${base}/api/ingest/ocean`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${writeKey.raw}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: validBatch })
  });
  assert.equal(rValid.status, 200);

  const rowSaved = await db.one("SELECT * FROM obs_ocean WHERE station_id='T1' AND date='2026-02-01'");
  assert.equal(rowSaved.chl, 0.85);
  assert.equal(rowSaved.sst, 29.2);

  // 5. Verifikasi log dicatat di ingest_log
  const log = await db.one("SELECT * FROM ingest_log WHERE api_key_id=? AND endpoint LIKE '%ocean%' AND status=200 ORDER BY id DESC LIMIT 1", [writeKey.id]);
  assert.ok(log, 'Log ingest sukses wajib ada');
  assert.equal(log.rows, 2);
});

test('ingest catch, catch-species, dan effort: validasi domain dan upsert', async () => {
  const writeKey = await insertKey('Fishery Bot', ['observations:write']);

  // Tangkapan kelompok
  const rCatch = await fetch(`${base}/api/ingest/catch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${writeKey.raw}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rows: [
        { region: 'karangantu', month: '2026-01', fish_group: 'pelagis_besar', catch_kg: 12500 }
      ]
    })
  });
  assert.equal(rCatch.status, 200);

  // Tangkapan spesies
  const rSpecies = await fetch(`${base}/api/ingest/catch-species`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${writeKey.raw}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rows: [
        { region: 'karangantu', month: '2026-01', species: 'tongkol_abu_abu', catch_kg: 8500 }
      ]
    })
  });
  assert.equal(rSpecies.status, 200);

  // Effort
  const rEffort = await fetch(`${base}/api/ingest/effort`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${writeKey.raw}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rows: [
        { region: 'karangantu', month: '2026-01', gear: 'purse_seine', trips: 145 }
      ]
    })
  });
  assert.equal(rEffort.status, 200);
});

test('ingest artifacts: validasi data contract dan upsert ke tabel artifacts', async () => {
  const artKey = await insertKey('ML Artifacts Bot', ['artifacts:write']);

  // 1. Kontrak salah: zones dengan jumlah zona < 5
  const badZones = {
    features: [
      { properties: { zone_id: 'Z-01', name: 'Zona 1', area_ha: 200, touches_coast: true } }
    ]
  };
  const rBad = await fetch(`${base}/api/ingest/artifacts/zones`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${artKey.raw}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: badZones, model_version: 'v1.0' })
  });
  assert.equal(rBad.status, 400);

  // 2. Kontrak benar: zones dengan 6 fitur dan field wajib
  const goodZones = {
    features: ['Z-01', 'Z-02', 'Z-03', 'Z-04', 'Z-05', 'Z-06'].map((id) => ({
      properties: {
        zone_id: id,
        name: `Zona ${id}`,
        area_ha: 300,
        touches_coast: true,
        month: '2026-03',
        msy: { pelagis_besar: 100, pelagis_kecil: 150, demersal: 80, total: 330 },
        tac: { pelagis_besar: 80, pelagis_kecil: 120, demersal: 64, total: 264 },
        abundance: { pelagis_besar: 'high', pelagis_kecil: 'mid', demersal: 'low' },
        season: 'peralihan_1',
        model_version: 'v1.2.0',
        generated_at: new Date().toISOString()
      }
    }))
  };

  const rGood = await fetch(`${base}/api/ingest/artifacts/zones`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${artKey.raw}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: goodZones,
      month: '2026-03',
      model_version: 'v1.2.0',
      generated_at: new Date().toISOString()
    })
  });
  assert.equal(rGood.status, 200);

  const savedArt = await db.one("SELECT * FROM artifacts WHERE name='zones'");
  assert.ok(savedArt, 'Artifact zones harus tersimpan di database');
  assert.equal(savedArt.model_version, 'v1.2.0');
});

test('admin API keys: CRUD API keys dan riwayat ingest logs', async () => {
  const { cookie } = await setupAdmin();

  // 1. Buat kunci baru lewat admin
  const rCreate = await fetch(`${base}/api/admin/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      name: 'Bot Cuaca BMKG',
      scopes: ['observations:write', 'observations:read']
    })
  });
  assert.equal(rCreate.status, 201);
  const created = await rCreate.json();
  assert.ok(created.key.startsWith('tsk_'), 'Harus mengembalikan kunci mentah tsk_');

  // 2. Daftar kunci
  const rList = await fetch(`${base}/api/admin/api-keys`, {
    headers: { Cookie: cookie }
  });
  assert.equal(rList.status, 200);
  const list = await rList.json();
  const found = list.keys.find((k) => k.id === created.id);
  assert.ok(found);
  assert.equal(found.name, 'Bot Cuaca BMKG');
  assert.equal(found.key_hash, undefined, 'Hash kunci tidak boleh bocor ke respons admin');

  // 3. Gunakan kunci yang baru dibuat
  const rUse = await fetch(`${base}/api/ingest/export`, {
    headers: { Authorization: `Bearer ${created.key}` }
  });
  assert.equal(rUse.status, 200);

  // 4. Cabut kunci lewat admin
  const rRevoke = await fetch(`${base}/api/admin/api-keys/${created.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie }
  });
  assert.equal(rRevoke.status, 200);

  // 5. Kunci yang sudah dicabut harus ditolak
  const rUseAfterRevoke = await fetch(`${base}/api/ingest/export`, {
    headers: { Authorization: `Bearer ${created.key}` }
  });
  assert.equal(rUseAfterRevoke.status, 401);

  // 6. Cek ingest logs
  const rLogs = await fetch(`${base}/api/admin/ingest-logs`, {
    headers: { Cookie: cookie }
  });
  assert.equal(rLogs.status, 200);
  const logsData = await rLogs.json();
  assert.ok(Array.isArray(logsData.logs));
  assert.ok(logsData.logs.length > 0);
});
