// Memindahkan akun dari data/db.json lama ke SQLite. Hash scrypt lama kompatibel.
// Akun demo bawaan (password terpublikasi di kode lama) sengaja dilewati.
import fs from 'node:fs';
import { db } from '../src/db.js';

const file = process.argv[2] || 'data/db.json';
const SKIP = new Set(['admin@terrasea.ac.id', 'researcher@terrasea.ac.id']);
if (!fs.existsSync(file)) {
  console.log(`Berkas ${file} tidak ditemukan. Tidak ada akun lama yang dipindahkan.`);
  process.exit(0);
}
const old = JSON.parse(fs.readFileSync(file, 'utf8'));
let n = 0;
for (const u of old.users) {
  if (SKIP.has(u.email)) continue;
  const res = await db.run(
    'INSERT OR IGNORE INTO users(name,email,password_hash,salt,role,status,created_at) VALUES (?,?,?,?,?,?,?)',
    [u.name, u.email.toLowerCase(), u.passwordHash, u.salt, u.role === 'admin' ? 'admin' : 'user', u.verified ? 'active' : 'pending', u.createdAt]
  );
  n += res.changes;
}
console.log(`${n} akun dipindahkan. Akun demo dilewati. Setelah itu hapus ${file} dari repositori.`);
