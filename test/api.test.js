import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.TURSO_DATABASE_URL = 'file:data/test.db';
process.env.SESSION_SECRET = 'rahasia-uji-minimal-16-karakter';

if (fs.existsSync('data/test.db')) fs.unlinkSync('data/test.db');

const { runMigrations } = await import('../src/migrate.js');
await runMigrations();

const { createApp } = await import('../src/app.js');
const { db } = await import('../src/db.js');
const { hashPassword, newEmailToken } = await import('../src/auth.js');

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
    if (fs.existsSync('data/test.db')) fs.unlinkSync('data/test.db');
  } catch {
    // abaikan jika masih terkunci di windows
  }
});

const addUser = async (email, { role = 'user', status = 'active' } = {}) => {
  const { hash, salt } = hashPassword('kata-sandi-uji-1');
  const res = await db.run(
    'INSERT INTO users(name,email,password_hash,salt,role,status,created_at) VALUES (?,?,?,?,?,?,?)',
    ['Uji', email, hash, salt, role, status, new Date().toISOString()]
  );
  return res.lastInsertRowid;
};

const post = (path, body, cookie) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) },
    body: JSON.stringify(body)
  });

const get = (path, cookie, opts = {}) =>
  fetch(base + path, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'manual',
    ...opts
  });

async function login(email) {
  const res = await post('/api/auth/login', { email, password: 'kata-sandi-uji-1' });
  return { res, cookie: res.headers.getSetCookie()[0]?.split(';')[0] };
}

test('tanpa sesi: API 401 dan halaman diarahkan ke /login', async () => {
  assert.equal((await get('/api/zones')).status, 401);
  const page = await get('/marine-stock');
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /^\/login/);
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/about')).status, 200);
});

test('halaman tertutup tidak bocor lewat folder statis', async () => {
  assert.equal((await get('/pages/marine-stock.html')).status, 404);
  assert.equal((await get('/views/marine-stock.html')).status, 404);
});

test('akun pending tidak bisa masuk; akun aktif bisa', async () => {
  await addUser('pending@uji.id', { status: 'pending' });
  await addUser('aktif@uji.id');
  assert.equal((await login('pending@uji.id')).res.status, 403);
  const { res, cookie } = await login('aktif@uji.id');
  assert.equal(res.status, 200);
  assert.equal((await get('/api/zones', cookie)).status, 200);
});

test('sesi berakhir tepat setelah 20 menit tanpa aktivitas', async () => {
  await addUser('idle@uji.id');
  const { cookie } = await login('idle@uji.id');
  await db.run('UPDATE sessions SET last_activity=?', [Date.now() - 20 * 60e3 - 1000]);
  const res = await get('/api/zones', cookie);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).expired, true);
});

test('token verifikasi: kedaluwarsa ditolak, valid sekali pakai', async () => {
  const id = await addUser('v@uji.id', { status: 'pending' });
  const old = newEmailToken();
  await db.run('INSERT INTO email_tokens(token_hash,user_id,expires_at) VALUES (?,?,?)', [old.hash, id, Date.now() - 1000]);
  assert.match((await get(`/api/auth/verify?token=${old.raw}`)).headers.get('location'), /verify=gagal/);
  const uPending = await db.one('SELECT status FROM users WHERE id=?', [id]);
  assert.equal(uPending.status, 'pending');

  const ok = newEmailToken();
  await db.run('INSERT INTO email_tokens(token_hash,user_id,expires_at) VALUES (?,?,?)', [ok.hash, id, Date.now() + 60e3]);
  assert.match((await get(`/api/auth/verify?token=${ok.raw}`)).headers.get('location'), /verify=ok/);
  const uActive = await db.one('SELECT status FROM users WHERE id=?', [id]);
  assert.equal(uActive.status, 'active');
  assert.match((await get(`/api/auth/verify?token=${ok.raw}`)).headers.get('location'), /verify=gagal/);
});

test('register tidak membocorkan token dan membuat akun pending', async () => {
  const res = await post('/api/auth/register', { name: 'Baru', email: 'baru@uji.id', password: 'kata-sandi-uji-1' });
  assert.equal(res.status, 201);
  assert.deepEqual(Object.keys(await res.json()), ['message']);
  const u = await db.one("SELECT status FROM users WHERE email='baru@uji.id'");
  assert.equal(u.status, 'pending');
});

test('/point hanya valid di dalam zona', async () => {
  await addUser('p@uji.id');
  const { cookie } = await login('p@uji.id');
  assert.equal((await get('/api/point?lat=-5.8&lng=105.5', cookie)).status, 404);
  const zones = await (await get('/api/zones', cookie)).json();
  const [[x1, y1], , [x2, y2]] = zones.features[0].geometry.coordinates[0];
  const res = await get(`/api/point?lat=${(y1 + y2) / 2}&lng=${(x1 + x2) / 2}`, cookie);
  assert.equal(res.status, 200);
  assert.ok(['high', 'mid', 'low'].includes((await res.json()).abundance.pelagis_besar));
});

test('admin: user biasa 403, admin 200', async () => {
  await addUser('u2@uji.id');
  await addUser('adm@uji.id', { role: 'admin' });
  assert.equal((await get('/api/admin/stats', (await login('u2@uji.id')).cookie)).status, 403);
  assert.equal((await get('/api/admin/stats', (await login('adm@uji.id')).cookie)).status, 200);
});

test('admin: manajemen antrean verifikasi, aktivasi manual, dan hapus', async () => {
  const pId = await addUser('pending.user@uji.id', { status: 'pending' });
  const { cookie: admCookie } = await login('adm@uji.id');

  // Cek antrean pending di stats membawa umur tautan (expires_at)
  const statsRes = await (await get('/api/admin/stats', admCookie)).json();
  const foundPending = statsRes.pending.find((u) => u.email === 'pending.user@uji.id');
  assert.ok(foundPending);
  assert.equal(foundPending.id, pId);

  // Aktifkan manual
  const actRes = await post(`/api/admin/users/${pId}/activate`, {}, admCookie);
  assert.equal(actRes.status, 200);
  const uActive = await db.one('SELECT status FROM users WHERE id=?', [pId]);
  assert.equal(uActive.status, 'active');

  // Hapus akun
  const pId2 = await addUser('hapus.user@uji.id', { status: 'pending' });
  const delRes = await fetch(base + `/api/admin/users/${pId2}`, { method: 'DELETE', headers: { Cookie: admCookie } });
  assert.equal(delRes.status, 200);
  const uDeleted = await db.one('SELECT 1 FROM users WHERE id=?', [pId2]);
  assert.equal(uDeleted, null);
});

test('admin: manajemen akun: nonaktifkan dan aktifkan kembali, blokir login', async () => {
  const uId = await addUser('member@uji.id', { status: 'active' });
  const { cookie: admCookie } = await login('adm@uji.id');

  // List semua user
  const listRes = await (await get('/api/admin/users', admCookie)).json();
  const found = listRes.users.find((u) => u.email === 'member@uji.id');
  assert.ok(found);
  assert.equal(found.status, 'active');

  // Nonaktifkan
  const deactRes = await post(`/api/admin/users/${uId}/deactivate`, {}, admCookie);
  assert.equal(deactRes.status, 200);
  const uInactive = await db.one('SELECT status FROM users WHERE id=?', [uId]);
  assert.equal(uInactive.status, 'inactive');

  // Login harus ditolak dengan 403
  const loginRes = await post('/api/auth/login', { email: 'member@uji.id', password: 'kata-sandi-uji-1' });
  assert.equal(loginRes.status, 403);
  const loginJson = await loginRes.json();
  assert.match(loginJson.message, /dinonaktifkan/i);

  // Aktifkan kembali
  const reactRes = await post(`/api/admin/users/${uId}/activate`, {}, admCookie);
  assert.equal(reactRes.status, 200);
  const uReactivated = await db.one('SELECT status FROM users WHERE id=?', [uId]);
  assert.equal(uReactivated.status, 'active');
});

test('admin: log unduhan dengan filter dan ringkasan', async () => {
  const { cookie: admCookie } = await login('adm@uji.id');
  const res = await get('/api/admin/downloads?type=msy', admCookie);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.downloads));
  assert.ok('summary' in data);
  assert.ok('total' in data.summary);
  assert.ok('top_type' in data.summary);
});

test('unduhan: xlsx valid, parameter salah ditolak, tercatat di log', async () => {
  await addUser('d@uji.id');
  const { cookie } = await login('d@uji.id');
  assert.equal((await get('/api/download?type=ngawur', cookie)).status, 400);
  assert.equal((await get('/api/download?type=msy&from=2026-12&to=2026-01', cookie)).status, 400);
  const res = await get('/api/download?type=msy&group=demersal&from=2026-01&to=2026-11', cookie);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  const log = await db.one("SELECT COUNT(*) c FROM download_log WHERE type='msy' AND fish_group='demersal'");
  assert.ok(Number(log.c) >= 1);
});

test('config: tanpa sesi 401, dengan sesi mengembalikan maptilerKey dan maptilerMapId', async () => {
  await addUser('cfg@uji.id');
  const { cookie } = await login('cfg@uji.id');
  assert.equal((await get('/api/config')).status, 401);
  const res = await get('/api/config', cookie);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok('maptilerKey' in data);
  assert.ok('maptilerMapId' in data);
});

test('admin: pencatatan bulanan tangkapan dan trip', async () => {
  const { cookie: admCookie } = await login('adm@uji.id');
  const { cookie: userCookie } = await login('u2@uji.id');

  // Akses GET tanpa auth -> 401, user biasa -> 403, admin -> 200
  assert.equal((await get('/api/admin/monthly-records')).status, 401);
  assert.equal((await get('/api/admin/monthly-records', userCookie)).status, 403);
  const getRes = await get('/api/admin/monthly-records', admCookie);
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert.ok(Array.isArray(getData.filled_months));
  assert.ok('latest_filled_month' in getData);

  // POST validasi: payload salah ditolak
  assert.equal((await post('/api/admin/monthly-records', { region: 'ngawur', month: '2026-11' }, admCookie)).status, 400);
  assert.equal((await post('/api/admin/monthly-records', { region: 'karangantu', month: 'invalid-month' }, admCookie)).status, 400);
  assert.equal((await post('/api/admin/monthly-records', {
    region: 'karangantu',
    month: '2026-11',
    catches: { pelagis_besar: -10, pelagis_kecil: 100, demersal: 100 },
    trips: 50
  }, admCookie)).status, 400);

  // POST sukses: simpan data tangkapan dan trip november 2026 ke depan
  const saveRes = await post('/api/admin/monthly-records', {
    region: 'karangantu',
    month: '2026-11',
    catches: {
      pelagis_besar: 2150.5,
      pelagis_kecil: 36200.0,
      demersal: 27800.0
    },
    trips: 1140,
    gear: 'total'
  }, admCookie);
  assert.equal(saveRes.status, 201);
  const saveJson = await saveRes.json();
  assert.equal(saveJson.success, true);

  // Verifikasi data tersimpan di obs_catch
  const pelagisBesarRow = await db.one(
    "SELECT catch_kg FROM obs_catch WHERE region='karangantu' AND month='2026-11' AND fish_group='pelagis_besar'"
  );
  assert.equal(Number(pelagisBesarRow.catch_kg), 2150.5);

  const demersalRow = await db.one(
    "SELECT catch_kg FROM obs_catch WHERE region='karangantu' AND month='2026-11' AND fish_group='demersal'"
  );
  assert.equal(Number(demersalRow.catch_kg), 27800.0);

  // Verifikasi data tersimpan di obs_effort
  const effortRow = await db.one(
    "SELECT trips FROM obs_effort WHERE region='karangantu' AND month='2026-11' AND gear='total'"
  );
  assert.equal(Number(effortRow.trips), 1140);
});
