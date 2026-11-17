import crypto from 'node:crypto';

// Sesi idle maksimal 20 menit (PRD bagian 6), divalidasi di server.
export const IDLE_MS = 20 * 60 * 1000;

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

export function verifyPassword(password, hash, salt) {
  const a = crypto.scryptSync(password, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Token mentah hanya dikirim lewat email. Yang disimpan di DB hanya hash-nya.
export function newEmailToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  return { raw, hash: sha256(raw) };
}

export const newSessionId = () => crypto.randomBytes(32).toString('hex');
