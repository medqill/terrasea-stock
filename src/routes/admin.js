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

export default r;
