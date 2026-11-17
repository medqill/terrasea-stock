import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.TURSO_DATABASE_URL = 'file:data/test_artifacts.db';
process.env.SESSION_SECRET = 'rahasia-uji-minimal-16-karakter';

if (fs.existsSync('data/test_artifacts.db')) {
  try { fs.unlinkSync('data/test_artifacts.db'); } catch {}
}

const { runMigrations } = await import('../src/migrate.js');
await runMigrations();

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const data = await import('../src/data.js');

let server, base, cookie;

before(async () => {
  // Setup user aktif untuk otentikasi endpoint
  const { hash, salt } = hashPassword('kata-sandi-uji-1');
  await db.run(
    "INSERT INTO users(name,email,password_hash,salt,role,status,created_at) VALUES (?,?,?,?,'user','active',?)",
    ['User Data', 'user.data@instansi.ac.id', hash, salt, new Date().toISOString()]
  );

  await new Promise((ok) => {
    server = createApp().listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      ok();
    });
  });

  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'user.data@instansi.ac.id', password: 'kata-sandi-uji-1' })
  });
  cookie = res.headers.getSetCookie()[0]?.split(';')[0];
});

after(async () => {
  server.close();
  try {
    if (fs.existsSync('data/test_artifacts.db')) fs.unlinkSync('data/test_artifacts.db');
  } catch {}
});

test('data.js: fallback otomatis ke fixture jika tabel artifacts kosong', async () => {
  data.clearCache();
  // DB test_artifacts.db belum memiliki baris di tabel artifacts
  const z = await data.getZones();
  assert.ok(z);
  assert.equal(z.fixture, true, 'Harus fallback ke fixture jika DB kosong');
  assert.ok(Array.isArray(z.data.features));

  const meta = await data.meta();
  assert.ok(meta);
  assert.equal(meta.is_fixture, true);

  // Cek endpoint /api/zones
  const res = await fetch(`${base}/api/zones`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.is_fixture, true);
});

test('data.js: membaca data dari tabel artifacts setelah di-insert', async () => {
  data.clearCache();

  // Insert artifact kustom ke tabel artifacts dengan is_fixture = 0
  const customZones = {
    features: ['Z-01', 'Z-02', 'Z-03', 'Z-04', 'Z-05', 'Z-06'].map((id) => ({
      properties: {
        zone_id: id,
        name: `Zona Kustom ${id}`,
        area_ha: 280,
        touches_coast: true,
        month: '2026-12',
        msy: { pelagis_besar: 120, pelagis_kecil: 180, demersal: 90, total: 390 },
        tac: { pelagis_besar: 96, pelagis_kecil: 144, demersal: 72, total: 312 },
        abundance: { pelagis_besar: 'high', pelagis_kecil: 'mid', demersal: 'low' },
        season: 'barat',
        model_version: 'v2.0.0-real',
        generated_at: '2026-12-01T00:00:00Z'
      }
    }))
  };

  await db.run(
    `INSERT INTO artifacts (name, month, content, model_version, generated_at, is_fixture, updated_at)
     VALUES ('zones', '2026-12', ?, 'v2.0.0-real', '2026-12-01T00:00:00Z', 0, datetime('now'))`,
    [JSON.stringify(customZones)]
  );

  data.clearCache();
  const z = await data.getZones();
  assert.ok(z);
  assert.equal(z.fixture, false, 'Harus bernilai false (bukan fixture) karena is_fixture=0 di DB');
  assert.equal(z.data.features[0].properties.name, 'Zona Kustom Z-01');
  assert.equal(z.model_version, 'v2.0.0-real');

  const meta = await data.meta();
  assert.equal(meta.month, '2026-12');
  assert.equal(meta.model_version, 'v2.0.0-real');
  assert.equal(meta.is_fixture, false);

  // Cek endpoint /api/meta
  const resMeta = await fetch(`${base}/api/meta`, { headers: { Cookie: cookie } });
  assert.equal(resMeta.status, 200);
  const jsonMeta = await resMeta.json();
  assert.equal(jsonMeta.model_version, 'v2.0.0-real');
  assert.equal(jsonMeta.is_fixture, false);

  // Cek endpoint /api/zones?month=2026-12
  const resZones = await fetch(`${base}/api/zones?month=2026-12`, { headers: { Cookie: cookie } });
  assert.equal(resZones.status, 200);
  const jsonZones = await resZones.json();
  assert.equal(jsonZones.features[0].properties.name, 'Zona Kustom Z-01');
  assert.equal(jsonZones.is_fixture, false);
});

