import { Router } from 'express';
import { db } from '../db.js';
import { hashPassword, verifyPassword, sha256, newEmailToken, newSessionId } from '../auth.js';
import { touchSession, loginLimiter, registerLimiter } from '../middleware.js';
import { sendVerifyMail } from '../mail.js';
import { asyncHandler } from '../async-handler.js';

const r = Router();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL_MS = 24 * 3600 * 1000;
// Dipakai agar waktu respons login tidak membedakan email terdaftar atau tidak.
const DUMMY = hashPassword('kata-sandi-tiruan');
const cookieOpts = () => ({ httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', signed: true });

r.post('/register', registerLimiter, asyncHandler(async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (name.length < 2 || name.length > 80) return res.status(400).json({ message: 'Nama harus 2 sampai 80 karakter.' });
  if (!EMAIL.test(email) || email.length > 200) return res.status(400).json({ message: 'Format email tidak valid.' });
  if (password.length < 8 || password.length > 200) return res.status(400).json({ message: 'Kata sandi harus 8 sampai 200 karakter.' });

  // Respons sama untuk email baru maupun lama, supaya daftar email tidak bisa ditebak.
  const generic = { message: 'Tautan verifikasi dikirim ke email Anda dan berlaku 24 jam. Akun aktif setelah tautan dibuka.' };
  const existing = await db.one('SELECT 1 FROM users WHERE email=?', [email]);
  if (existing) return res.status(201).json(generic);

  const { hash, salt } = hashPassword(password);
  const token = newEmailToken();
  const nowIso = new Date().toISOString();
  const expiresAt = Date.now() + TOKEN_TTL_MS;

  // Batch insert user dan email token secara atomik
  const batchRes = await db.tx([
    {
      sql: 'INSERT INTO users(name,email,password_hash,salt,created_at) VALUES (?,?,?,?,?)',
      args: [name, email, hash, salt, nowIso]
    },
    {
      sql: 'INSERT INTO email_tokens(token_hash,user_id,expires_at) VALUES (?,last_insert_rowid(),?)',
      args: [token.hash, expiresAt]
    }
  ]);
  const userId = Number(batchRes[0].lastInsertRowid);

  try {
    const base = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    await sendVerifyMail(email, `${base}/api/auth/verify?token=${token.raw}`);
  } catch {
    await db.run('DELETE FROM users WHERE id=?', [userId]); // token ikut terhapus (CASCADE)
    return res.status(502).json({ message: 'Email verifikasi gagal dikirim. Coba lagi nanti.' });
  }
  res.status(201).json(generic);
}));

r.get('/verify', asyncHandler(async (req, res) => {
  const hash = sha256(String(req.query.token || ''));
  const row = await db.one('SELECT * FROM email_tokens WHERE token_hash=? AND used_at IS NULL AND expires_at>?', [hash, Date.now()]);
  if (!row) return res.redirect('/login?verify=gagal');
  // Batch update token status dan aktivasi user secara atomik
  await db.tx([
    {
      sql: 'UPDATE email_tokens SET used_at=? WHERE token_hash=?',
      args: [Date.now(), hash]
    },
    {
      sql: "UPDATE users SET status='active' WHERE id=?",
      args: [row.user_id]
    }
  ]);
  res.redirect('/login?verify=ok');
}));

r.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '').slice(0, 200);
  const u = await db.one('SELECT * FROM users WHERE email=?', [email]);
  const match = verifyPassword(password, u?.password_hash ?? DUMMY.hash, u?.salt ?? DUMMY.salt);
  if (!u || !match) return res.status(401).json({ message: 'Email atau kata sandi tidak valid.' });
  if (u.status === 'inactive') return res.status(403).json({ message: 'Akun telah dinonaktifkan oleh administrator.' });
  if (u.status !== 'active') return res.status(403).json({ message: 'Akun belum diverifikasi. Buka tautan di email Anda.' });

  const sid = newSessionId();
  const now = Date.now();
  await db.run('INSERT INTO sessions(id,user_id,created_at,last_activity) VALUES (?,?,?,?)', [sid, u.id, now, now]);
  res.cookie('sid', sid, cookieOpts());
  res.json({ user: { name: u.name, email: u.email, role: u.role } });
}));

r.post('/logout', asyncHandler(async (req, res) => {
  const sid = req.signedCookies?.sid;
  if (sid) await db.run('DELETE FROM sessions WHERE id=?', [sid]);
  res.clearCookie('sid');
  res.json({ message: 'Anda sudah keluar.' });
}));

// Juga dipakai sebagai heartbeat klien: setiap panggilan memperpanjang sesi.
r.get('/me', asyncHandler(async (req, res) => {
  const { user, expired } = await touchSession(req.signedCookies?.sid);
  if (!user) {
    res.clearCookie('sid');
    return res.json({ authenticated: false, expired });
  }
  res.json({ authenticated: true, user });
}));

export default r;
