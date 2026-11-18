import { Router } from 'express';
import crypto from 'node:crypto';
import { db } from '../db.js';
import * as data from '../data.js';
import { asyncHandler } from '../async-handler.js';

const r = Router();

r.get('/stats', asyncHandler(async (req, res) => {
  const count = async (where) => Number((await db.one(`SELECT COUNT(*) c FROM users ${where}`))?.c ?? 0);
  const [total, active, pendingCount, pending, downloads] = await Promise.all([
    count(''),
    count("WHERE status='active'"),
    count("WHERE status='pending'"),
    db.query(
      `SELECT u.id, u.name, u.email, u.created_at, t.expires_at, t.used_at
       FROM users u
       LEFT JOIN email_tokens t ON t.user_id = u.id AND t.used_at IS NULL
       WHERE u.status = 'pending'
       ORDER BY u.created_at DESC
       LIMIT 50`
    ),
    db.query(
      `SELECT d.id, d.created_at, d.type, d.period_from, d.period_to, d.fish_group, u.email
       FROM download_log d LEFT JOIN users u ON u.id = d.user_id ORDER BY d.id DESC LIMIT 20`
    )
  ]);
  res.json({
    accounts: { total, active, pending: pendingCount },
    pending,
    downloads,
    model: await data.meta()
  });
}));

// GET /api/admin/users - Manajemen akun: seluruh akun pengguna
r.get('/users', asyncHandler(async (req, res) => {
  const users = await db.query(
    `SELECT u.id, u.name, u.email, u.role, u.status, u.created_at,
            MAX(s.last_activity) AS last_seen
     FROM users u
     LEFT JOIN sessions s ON s.user_id = u.id
     GROUP BY u.id
     ORDER BY u.id ASC`
  );
  res.json({ users });
}));

// POST /api/admin/users/:id/activate - Aktifkan akun
r.post('/users/:id/activate', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID pengguna tidak valid.' });

  const u = await db.one('SELECT id, name, email, status FROM users WHERE id = ?', [id]);
  if (!u) return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });

  const now = Date.now();
  await db.tx([
    {
      sql: "UPDATE users SET status = 'active' WHERE id = ?",
      args: [id]
    },
    {
      sql: 'UPDATE email_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL',
      args: [now, id]
    }
  ]);

  res.json({ success: true, message: `Akun "${u.email}" berhasil diaktifkan.` });
}));

// POST /api/admin/users/:id/deactivate - Nonaktifkan akun
r.post('/users/:id/deactivate', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID pengguna tidak valid.' });

  if (req.user?.id === id) {
    return res.status(400).json({ message: 'Anda tidak dapat menonaktifkan akun Anda sendiri.' });
  }

  const u = await db.one('SELECT id, name, email, status FROM users WHERE id = ?', [id]);
  if (!u) return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });

  await db.tx([
    {
      sql: "UPDATE users SET status = 'inactive' WHERE id = ?",
      args: [id]
    },
    {
      sql: 'DELETE FROM sessions WHERE user_id = ?',
      args: [id]
    }
  ]);

  res.json({ success: true, message: `Akun "${u.email}" berhasil dinonaktifkan.` });
}));

// DELETE /api/admin/users/:id - Hapus akun
r.delete('/users/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID pengguna tidak valid.' });

  if (req.user?.id === id) {
    return res.status(400).json({ message: 'Anda tidak dapat menghapus akun Anda sendiri.' });
  }

  const u = await db.one('SELECT id, name, email FROM users WHERE id = ?', [id]);
  if (!u) return res.status(404).json({ message: 'Pengguna tidak ditemukan.' });

  await db.run('DELETE FROM users WHERE id = ?', [id]);

  res.json({ success: true, message: `Akun "${u.email}" berhasil dihapus.` });
}));

// GET /api/admin/downloads - Riwayat unduhan dengan filter & ringkasan "unduhan terbanyak"
r.get('/downloads', asyncHandler(async (req, res) => {
  const { type, period_from, period_to } = req.query;
  const whereClauses = [];
  const args = [];

  if (type && type !== 'all' && type !== 'semua') {
    whereClauses.push('d.type = ?');
    args.push(type);
  }
  if (period_from) {
    whereClauses.push('(d.period_to >= ? OR d.created_at >= ?)');
    args.push(period_from, period_from);
  }
  if (period_to) {
    whereClauses.push('(d.period_from <= ? OR d.created_at <= ?)');
    args.push(period_to, period_to);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const downloads = await db.query(
    `SELECT d.id, d.created_at, d.type, d.period_from, d.period_to, d.fish_group, u.email
     FROM download_log d
     LEFT JOIN users u ON u.id = d.user_id
     ${whereSql}
     ORDER BY d.id DESC LIMIT 100`,
    args
  );

  // Summary agregat untuk filter ini
  const topTypeRow = await db.one(
    `SELECT type, COUNT(*) as cnt FROM download_log d ${whereSql} GROUP BY type ORDER BY cnt DESC LIMIT 1`,
    args
  );
  const topUserRow = await db.one(
    `SELECT u.email, COUNT(*) as cnt FROM download_log d LEFT JOIN users u ON u.id = d.user_id ${whereSql} GROUP BY d.user_id ORDER BY cnt DESC LIMIT 1`,
    args
  );
  const topGroupRow = await db.one(
    `SELECT fish_group, COUNT(*) as cnt FROM download_log d ${whereSql ? whereSql + ' AND' : 'WHERE'} fish_group IS NOT NULL AND fish_group != '' GROUP BY fish_group ORDER BY cnt DESC LIMIT 1`,
    args
  );
  const totalCountRow = await db.one(
    `SELECT COUNT(*) as total FROM download_log d ${whereSql}`,
    args
  );

  res.json({
    downloads,
    summary: {
      total: Number(totalCountRow?.total ?? 0),
      top_type: topTypeRow ? `${topTypeRow.type} (${topTypeRow.cnt}x)` : '-',
      top_user: topUserRow && topUserRow.email ? `${topUserRow.email} (${topUserRow.cnt}x)` : '-',
      top_group: topGroupRow ? `${topGroupRow.fish_group} (${topGroupRow.cnt}x)` : '-'
    }
  });
}));

// GET /api/admin/api-keys - Daftar kunci API bot
r.get('/api-keys', asyncHandler(async (req, res) => {
  const keys = await db.query(
    'SELECT id, name, scopes, created_at, last_used_at, revoked_at FROM api_keys ORDER BY id DESC'
  );
  res.json({ keys });
}));

// POST /api/admin/api-keys - Buat kunci API bot baru
r.post('/api-keys', asyncHandler(async (req, res) => {
  const { name, scopes } = req.body || {};
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ message: 'Nama kunci API wajib diisi.' });
  }

  // Normalisasi scopes (array atau comma-separated)
  let scopeList = [];
  if (Array.isArray(scopes)) {
    scopeList = scopes.map((s) => String(s).trim()).filter(Boolean);
  } else if (typeof scopes === 'string') {
    scopeList = scopes.split(/[\s,]+/).filter(Boolean);
  }

  const allowedScopes = ['observations:write', 'observations:read', 'artifacts:write', 'admin'];
  const validScopes = scopeList.filter((s) => allowedScopes.includes(s));
  if (validScopes.length === 0) {
    return res.status(400).json({ message: `Minimal satu scope valid wajib dipilih (${allowedScopes.join(', ')}).` });
  }

  const rawKey = `tsk_${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const scopeStr = validScopes.join(',');

  const result = await db.run(
    "INSERT INTO api_keys (name, key_hash, scopes, created_at) VALUES (?, ?, ?, datetime('now'))",
    [name.trim(), keyHash, scopeStr]
  );

  res.status(201).json({
    id: result.lastInsertRowid ?? result.last_insert_rowid ?? null,
    name: name.trim(),
    key: rawKey, // Kunci mentah HANYA dikembalikan saat pertama kali dibuat
    scopes: scopeStr,
    message: 'Simpan kunci ini di tempat aman. Kunci ini tidak akan ditampilkan lagi.'
  });
}));

// DELETE /api/admin/api-keys/:id - Cabut kunci API bot
r.delete('/api-keys/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID tidak valid.' });

  const result = await db.run(
    "UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL",
    [id]
  );

  if (result.changes === 0) {
    return res.status(404).json({ message: 'Kunci tidak ditemukan atau sudah dicabut.' });
  }

  res.json({ success: true, message: 'Kunci API berhasil dicabut.' });
}));

// GET /api/admin/ingest-logs - Riwayat 20 entri ingest_log terakhir
r.get('/ingest-logs', asyncHandler(async (req, res) => {
  const logs = await db.query(
    `SELECT i.id, i.endpoint, i.status, i.rows, i.detail, i.created_at, k.name AS key_name
     FROM ingest_log i
     LEFT JOIN api_keys k ON k.id = i.api_key_id
     ORDER BY i.id DESC LIMIT 20`
  );
  res.json({ logs });
}));

// GET /api/admin/monthly-records - Data status pencatatan bulanan tangkapan dan trip
r.get('/monthly-records', asyncHandler(async (req, res) => {
  const [filledMonths, maxKarangantu, maxLebak, recentCatches, recentEfforts] = await Promise.all([
    db.query(
      `SELECT region, month, SUM(catch_kg) AS total_catch_kg, COUNT(*) AS count_group
       FROM obs_catch
       GROUP BY region, month
       ORDER BY month DESC, region ASC
       LIMIT 60`
    ),
    db.one("SELECT MAX(month) AS m FROM obs_catch WHERE region = 'karangantu'"),
    db.one("SELECT MAX(month) AS m FROM obs_catch WHERE region = 'lebak'"),
    db.query(
      `SELECT region, month, fish_group, catch_kg, updated_at
       FROM obs_catch
       ORDER BY updated_at DESC, month DESC
       LIMIT 20`
    ),
    db.query(
      `SELECT region, month, gear, trips, updated_at
       FROM obs_effort
       ORDER BY updated_at DESC, month DESC
       LIMIT 20`
    )
  ]);

  const gears = {
    karangantu: ['total', 'jaring_insang_tetap', 'jaring_hela_dasar', 'jaring_insang_hanyut', 'bagan_tancap', 'bagan_berperahu', 'bubu', 'pancing', 'jaring_payang', 'lain_lain'],
    lebak: ['total', 'jaring_insang_tetap', 'pancing', 'jaring_insang_hanyut', 'rawai', 'lainnya', 'trammel_net', 'pukat_cincin', 'payang']
  };

  res.json({
    latest_filled_month: {
      karangantu: maxKarangantu?.m ?? null,
      lebak: maxLebak?.m ?? null
    },
    filled_months: filledMonths,
    recent_catches: recentCatches,
    recent_efforts: recentEfforts,
    gears
  });
}));

// POST /api/admin/monthly-records - Pencatatan data tangkapan bulanan dan trip ke database
r.post('/monthly-records', asyncHandler(async (req, res) => {
  const { region, month, catches, trips, gear = 'total' } = req.body || {};

  // Validasi wilayah
  if (!region || !['karangantu', 'lebak'].includes(String(region).toLowerCase())) {
    return res.status(400).json({ message: 'Wilayah tidak valid. Pilih "karangantu" atau "lebak".' });
  }

  // Validasi format bulan YYYY-MM
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) {
    return res.status(400).json({ message: 'Format bulan tidak valid. Gunakan format YYYY-MM (misal 2026-11).' });
  }

  // Validasi data tangkapan
  const c = catches || {};
  const pelagisBesar = Number(c.pelagis_besar);
  const pelagisKecil = Number(c.pelagis_kecil);
  const demersal = Number(c.demersal);

  if (isNaN(pelagisBesar) || pelagisBesar < 0 || isNaN(pelagisKecil) || pelagisKecil < 0 || isNaN(demersal) || demersal < 0) {
    return res.status(400).json({ message: 'Nilai tangkapan untuk Pelagis Besar, Pelagis Kecil, dan Demersal harus berupa angka non-negatif.' });
  }

  // Validasi data trip (effort)
  const numTrips = Number(trips);
  if (isNaN(numTrips) || numTrips < 0) {
    return res.status(400).json({ message: 'Jumlah trip harus berupa angka non-negatif.' });
  }

  const cleanRegion = String(region).toLowerCase();
  const cleanGear = String(gear || 'total').trim().toLowerCase();

  // Eksekusi atomik menggunakan db.tx
  const statements = [
    {
      sql: `INSERT INTO obs_catch (region, month, fish_group, catch_kg, created_at, updated_at)
            VALUES (?, ?, 'pelagis_besar', ?, datetime('now'), datetime('now'))
            ON CONFLICT(region, month, fish_group) DO UPDATE SET
              catch_kg = excluded.catch_kg, updated_at = datetime('now')`,
      args: [cleanRegion, month, pelagisBesar]
    },
    {
      sql: `INSERT INTO obs_catch (region, month, fish_group, catch_kg, created_at, updated_at)
            VALUES (?, ?, 'pelagis_kecil', ?, datetime('now'), datetime('now'))
            ON CONFLICT(region, month, fish_group) DO UPDATE SET
              catch_kg = excluded.catch_kg, updated_at = datetime('now')`,
      args: [cleanRegion, month, pelagisKecil]
    },
    {
      sql: `INSERT INTO obs_catch (region, month, fish_group, catch_kg, created_at, updated_at)
            VALUES (?, ?, 'demersal', ?, datetime('now'), datetime('now'))
            ON CONFLICT(region, month, fish_group) DO UPDATE SET
              catch_kg = excluded.catch_kg, updated_at = datetime('now')`,
      args: [cleanRegion, month, demersal]
    },
    {
      sql: `INSERT INTO obs_effort (region, month, gear, trips, created_at, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(region, month, gear) DO UPDATE SET
              trips = excluded.trips, updated_at = datetime('now')`,
      args: [cleanRegion, month, cleanGear, Math.round(numTrips)]
    }
  ];

  await db.tx(statements);

  res.status(201).json({
    success: true,
    message: `Data tangkapan dan trip wilayah ${cleanRegion === 'karangantu' ? 'Karangantu' : 'Lebak'} bulan ${month} berhasil disimpan.`,
    data: {
      region: cleanRegion,
      month,
      catches: {
        pelagis_besar: pelagisBesar,
        pelagis_kecil: pelagisKecil,
        demersal
      },
      trips: Math.round(numTrips),
      gear: cleanGear
    }
  });
}));

export default r;
