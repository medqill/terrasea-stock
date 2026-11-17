import crypto from 'node:crypto';
import { db } from './db.js';
import { IDLE_MS } from './auth.js';
export { loginLimiter, registerLimiter, downloadLimiter } from './ratelimit.js';

/**
 * Perpanjang sesi hanya bila belum idle > 20 menit. UPDATE tunggal membuat
 * pemeriksaan dan perpanjangan atomik, jadi tidak ada celah antara cek dan tulis.
 */
export async function touchSession(sid) {
  if (!sid) return { user: null, expired: false };
  const now = Date.now();
  const res = await db.run(
    'UPDATE sessions SET last_activity=? WHERE id=? AND last_activity>?',
    [now, sid, now - IDLE_MS]
  );
  const ok = res.changes === 1;
  if (!ok) {
    await db.run('DELETE FROM sessions WHERE id=?', [sid]);
    return { user: null, expired: true };
  }
  const user = await db.one(
    "SELECT u.id,u.name,u.email,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.id=? AND u.status='active'",
    [sid]
  );
  return { user: user || null, expired: false };
}

const isApi = (req) => req.originalUrl.startsWith('/api');

export async function requireAuth(req, res, next) {
  try {
    const sid = req.signedCookies?.sid;
    const { user, expired } = await touchSession(sid);
    if (!user) {
      res.clearCookie('sid');
      if (isApi(req)) {
        return res.status(401).json({ message: 'Sesi berakhir. Silakan masuk kembali.', expired });
      }
      return res.redirect(expired ? '/login?expired=1' : '/login');
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  if (isApi(req)) return res.status(403).json({ message: 'Khusus admin.' });
  res.redirect('/marine-stock');
}


/**
 * Catat aktivitas ingest bot ke tabel ingest_log.
 */
export async function logIngest(apiKeyId, endpoint, status, rows = 0, detail = null) {
  try {
    await db.run(
      "INSERT INTO ingest_log (api_key_id, endpoint, status, rows, detail, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
      [apiKeyId || null, endpoint, status, rows, detail ? String(detail).slice(0, 500) : null]
    );
  } catch (err) {
    console.error('Gagal mencatat ingest_log:', err.message);
  }
}

/**
 * Middleware autentikasi API Key bot bertingkat scope.
 * Header: Authorization: Bearer tsk_<hex>
 */
export function requireApiKey(requiredScope) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      await logIngest(null, req.originalUrl, 401, 0, 'Header Authorization Bearer tidak ada');
      return res.status(401).json({ message: 'Header Authorization: Bearer <kunci> wajib disertakan.' });
    }

    const token = authHeader.slice(7).trim();
    if (!token.startsWith('tsk_')) {
      await logIngest(null, req.originalUrl, 401, 0, 'Format token salah');
      return res.status(401).json({ message: 'Format kunci API tidak valid. Harus diawali tsk_.' });
    }

    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const key = await db.one(
      'SELECT id, name, scopes, revoked_at FROM api_keys WHERE key_hash = ?',
      [hash]
    );

    if (!key || key.revoked_at) {
      await logIngest(key?.id || null, req.originalUrl, 401, 0, key ? 'Kunci telah dicabut' : 'Kunci tidak ditemukan');
      return res.status(401).json({ message: 'Kunci API tidak valid atau telah dicabut.' });
    }

    const scopes = key.scopes ? key.scopes.split(/[\s,]+/).filter(Boolean) : [];
    if (requiredScope && !scopes.includes(requiredScope) && !scopes.includes('admin')) {
      await logIngest(key.id, req.originalUrl, 403, 0, `Scope tidak cukup: butuh ${requiredScope}`);
      return res.status(403).json({ message: `Kunci API tidak memiliki izin yang diperlukan (${requiredScope}).` });
    }

    // Perbarui last_used_at secara atomik
    await db.run("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?", [key.id]);

    req.apiKey = { id: key.id, name: key.name, scopes };
    next();
  };
}
