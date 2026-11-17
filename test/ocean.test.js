import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.TURSO_DATABASE_URL = 'file:data/test_ocean.db';
process.env.SESSION_SECRET = 'rahasia-uji-minimal-16-karakter';
if (fs.existsSync('data/test_ocean.db')) { try { fs.unlinkSync('data/test_ocean.db'); } catch {} }

const { runMigrations } = await import('../src/migrate.js');
await runMigrations();
const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');
const { validateArtifact, addDays } = await import('../src/contract.js');
const { cleanupOldDgrids } = await import('../src/dgrid-cleanup.js');
const { bilinear, speedAndDirection } = await import('../public/js/gridlookup.js');
const data = await import('../src/data.js');

let server, base;
before(() => new Promise((ok) => {
  server = createApp().listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; ok(); });
}));
after(() => { server.close(); try { fs.unlinkSync('data/test_ocean.db'); } catch {} });

const diff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
function makeWindow(ref = '2026-11-10', through = '2026-11-08') {
  const days = [-3, -2, -1, 0, 1, 2, 3].map((o) => {
    const date = addDays(ref, o), obs = date <= through;
    return { date, offset: o, kind: obs ? 'observed' : 'forecast', horizon_days: obs ? null : diff(date, through) };
  });
  const sc = (unit) => ({ vmin: 0, vmax: 1, unit });
  return {
    reference_date: ref, data_through: through, stale: diff(ref, through) > 7, days,
    scale: { sst: sc('°C'), chl: sc('mg/m³'), current: sc('m/s') },
    metrics: [{ var: 'sst', horizon_days: 1, rmse: 0.3, mae: 0.2, baseline_persistence_rmse: 0.4, baseline_climatology_rmse: 0.5 }],
    idw: { power: 2, max_distance_km: 150, loocv: { sst: { rmse: 0.2 }, chl: { rmse: 0.1 }, current: { rmse: 0.05 } } },
    model_version: 't', generated_at: new Date().toISOString()
  };
}
function makeDgrid(v, date, extra = {}) {
  const g = { var: v, unit: 'u', date, kind: 'observed', bbox: [0, 0, 2, 2], nx: 2, ny: 2, values: [1, 2, null, 4], vmin: 1, vmax: 4, model_version: 't', generated_at: new Date().toISOString() };
  if (v === 'current') { g.uo = [0.1, 0.2, null, 0.1]; g.vo = [0, 0, null, -0.1]; }
  return { ...g, ...extra };
}

test('contract: ocean_window dan dgrid valid diterima', () => {
  assert.deepEqual(validateArtifact('ocean_window', makeWindow()).errors, []);
  assert.deepEqual(validateArtifact('dgrid:sst:2026-11-10', makeDgrid('sst', '2026-11-10')).errors, []);
  assert.deepEqual(validateArtifact('dgrid:current:2026-11-10', makeDgrid('current', '2026-11-10')).errors, []);
  assert.ok(validateArtifact('abundance:2026-11', { nx: 1, ny: 1, groups: { pelagis_besar: ['mid'], pelagis_kecil: ['mid'], demersal: ['mid'] } }).valid);
});

test('contract: field wajib hilang atau nilai chl/speed negatif ditolak', () => {
  const w = makeWindow(); delete w.idw;
  assert.ok(!validateArtifact('ocean_window', w).valid);
  assert.ok(!validateArtifact('ocean_window', { ...makeWindow(), days: makeWindow().days.slice(0, 6) }).valid);
  assert.ok(!validateArtifact('ocean_window', { ...makeWindow(), stale: true }).valid, 'stale harus konsisten');
  const g = makeDgrid('chl', '2026-11-10'); delete g.bbox;
  assert.ok(!validateArtifact('dgrid:chl:2026-11-10', g).valid);
  assert.ok(!validateArtifact('dgrid:chl:2026-11-10', makeDgrid('chl', '2026-11-10', { values: [1, -0.1, null, 2] })).valid);
  assert.ok(!validateArtifact('dgrid:current:2026-11-10', makeDgrid('current', '2026-11-10', { values: [1, -0.1, null, 2] })).valid);
  assert.ok(!validateArtifact('dgrid:current:2026-11-10', makeDgrid('current', '2026-11-10', { vo: undefined })).valid);
  assert.ok(!validateArtifact('dgrid:sst:2026-11-10', makeDgrid('sst', '2026-11-11')).valid, 'tanggal harus cocok dengan nama');
  assert.ok(validateArtifact('dgrid:sst:2026-11-10', makeDgrid('sst', '2026-11-10', { values: [-1, 2, null, 4], vmin: -1 })).valid, 'SST boleh berapa pun (validasi rentang ada di impor)');
});

let key;
async function insertKey(scopes) {
  const raw = `tsk_${crypto.randomBytes(24).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  await db.run("INSERT INTO api_keys (name, key_hash, scopes, created_at) VALUES ('t', ?, ?, datetime('now'))", [hash, scopes]);
  return raw;
}
const put = (name, content) => fetch(`${base}/api/ingest/artifacts/${encodeURIComponent(name)}`, {
  method: 'PUT', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content })
});

test('PUT artifacts: menerima ocean_window/dgrid, menolak nama di luar pola', async () => {
  key = await insertKey('artifacts:write');
  assert.equal((await put('ocean_window', makeWindow())).status, 200);
  assert.equal((await put('dgrid:sst:2026-11-10', makeDgrid('sst', '2026-11-10'))).status, 200);
  assert.equal((await put('dgrid:sst:2026-11-10', makeDgrid('sst', '2026-11-10', { values: [1] }))).status, 400);
  for (const bad of ['dgrid:xyz:2026-11-10', 'dgrid:sst:10-11-2026', 'sembarang', 'forecast:Z-1', '..%2Fx']) {
    assert.equal((await put(bad, makeDgrid('sst', '2026-11-10'))).status, 400, bad);
  }
});

test('DELETE artifacts: hanya dgrid; pembersihan menghapus dgrid > 14 hari', async () => {
  const del = (name) => fetch(`${base}/api/ingest/artifacts/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${key}` } });
  assert.equal((await del('zones')).status, 400);
  assert.equal((await del('dgrid:sst:2026-11-10')).status, 200);
  assert.equal((await del('dgrid:sst:2026-11-10')).status, 404);

  const today = '2026-11-10';
  for (const d of ['2026-10-20', '2026-10-27', '2026-10-28', '2026-11-10']) {
    await db.run("INSERT OR REPLACE INTO artifacts(name, content, updated_at) VALUES (?, '{}', datetime('now'))", [`dgrid:chl:${d}`]);
  }
  await db.run("INSERT OR REPLACE INTO artifacts(name, content, updated_at) VALUES ('zones', '{}', datetime('now'))");
  assert.equal(await cleanupOldDgrids(db, { today, keepDays: 14 }), 1); // cutoff = 2026-10-27; hanya 10-20 yang lebih tua
  const left = (await db.query("SELECT name FROM artifacts WHERE name LIKE 'dgrid:chl:%' ORDER BY name")).map((r) => r.name);
  assert.deepEqual(left, ['dgrid:chl:2026-10-27', 'dgrid:chl:2026-10-28', 'dgrid:chl:2026-11-10']);
  assert.ok(await db.one("SELECT 1 FROM artifacts WHERE name='zones'"), 'artifact non-dgrid tidak boleh terhapus');
});

test('route baca /api/ocean-window dan /api/dgrids: wajib sesi, 404 bila belum ada', async () => {
  const { hash, salt } = hashPassword('kata-sandi-uji-1');
  await db.run("INSERT INTO users(name,email,password_hash,salt,role,status,created_at) VALUES ('U','o@uji.id',?,?,'user','active',?)", [hash, salt, new Date().toISOString()]);
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'o@uji.id', password: 'kata-sandi-uji-1' }) });
  const cookie = res.headers.getSetCookie()[0].split(';')[0];
  const get = (p, c) => fetch(base + p, { headers: c ? { Cookie: c } : {} });

  assert.equal((await get('/api/ocean-window')).status, 401);
  assert.equal((await get('/api/dgrids/sst?date=2026-11-09')).status, 401);
  data.clearCache();
  assert.equal((await get('/api/ocean-window', cookie)).status, 200);
  await db.run("INSERT OR REPLACE INTO artifacts(name, content, updated_at) VALUES ('dgrid:sst:2026-11-09', ?, datetime('now'))", [JSON.stringify(makeDgrid('sst', '2026-11-09'))]);
  data.clearCache();
  assert.equal((await get('/api/dgrids/sst?date=2026-11-09', cookie)).status, 200);
  assert.equal((await get('/api/dgrids/sst?date=2026-01-01', cookie)).status, 404);
  assert.equal((await get('/api/dgrids/xyz?date=2026-11-09', cookie)).status, 400);
  assert.equal((await get('/api/dgrids/sst?date=besok', cookie)).status, 400);
  assert.equal((await get('/api/ingest/artifacts/ocean_window')).status, 404, 'GET lama di /api/ingest sudah dihapus');
});

test('gridlookup: bilinear benar pada grid kecil, null di sel null, di luar bbox null', () => {
  const g = { bbox: [0, 0, 2, 2], nx: 2, ny: 2, values: [1, 2, 3, 4] }; // baris pertama = utara
  assert.equal(bilinear(g, 0.5, 1.5), 1);      // pusat sel barat laut
  assert.equal(bilinear(g, 1.5, 1.5), 2);
  assert.equal(bilinear(g, 0.5, 0.5), 3);
  assert.equal(bilinear(g, 1, 1), 2.5);        // rata-rata empat sel
  assert.equal(bilinear(g, 1, 1.5), 1.5);      // antara sel 1 dan 2
  assert.equal(bilinear(g, 3, 1), null);
  assert.equal(bilinear(g, 1, -0.1), null);
  const n = { ...g, values: [1, null, 3, 4] };
  assert.equal(bilinear(n, 1.5, 1.5), null);
  assert.equal(bilinear(n, 1, 1), null);
  assert.equal(bilinear(n, 0.5, 0.5), 3);      // sel tetangga null berbobot 0 tidak ikut
});

test('gridlookup: arah tujuan arus dari uo/vo untuk keempat mata angin', () => {
  assert.equal(speedAndDirection(0, 1).direction_deg, 0);    // Utara
  assert.equal(speedAndDirection(1, 0).direction_deg, 90);   // Timur
  assert.equal(speedAndDirection(0, -1).direction_deg, 180); // Selatan
  assert.equal(speedAndDirection(-1, 0).direction_deg, 270); // Barat
  assert.equal(speedAndDirection(3, 4).speed, 5);
  assert.deepEqual(speedAndDirection(null, 1), { speed: null, direction_deg: null });
});
