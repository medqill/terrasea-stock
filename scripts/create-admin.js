// Buat atau promosikan admin.
// Pakai: node scripts/create-admin.js "Nama Admin" email@instansi.ac.id [password]
import 'dotenv/config';
import readline from 'node:readline';
import { createClient } from '@libsql/client';
import { db } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const [name, emailRaw, passwordArg] = process.argv.slice(2);
if (!name || !emailRaw) {
  console.error('Pakai: node scripts/create-admin.js "Nama" email@contoh.ac.id [password]');
  process.exit(1);
}
const email = emailRaw.toLowerCase();

async function saveAdmin(pw) {
  if (!pw || pw.length < 4) {
    console.error('Kata sandi terlalu pendek (minimal 4 karakter).');
    process.exit(1);
  }
  const { hash, salt } = hashPassword(pw);
  const now = new Date().toISOString();

  // 1. Simpan ke database yang aktif di src/db.js (Turso atau local.db)
  try {
    await db.run(
      `INSERT INTO users(name,email,password_hash,salt,role,status,created_at) VALUES (?,?,?,?, 'admin','active',?)
       ON CONFLICT(email) DO UPDATE SET name=excluded.name, role='admin', status='active', password_hash=excluded.password_hash, salt=excluded.salt`,
      [name, email, hash, salt, now]
    );
    console.log(`Admin siap di database utama: ${email}`);
  } catch (err) {
    console.error('Gagal membuat admin di database utama:', err.message);
  }

  // 2. Simpan juga ke file:data/local.db sebagai jaminan fallback offline
  try {
    const local = createClient({ url: 'file:data/local.db' });
    await local.execute({
      sql: `INSERT INTO users(name,email,password_hash,salt,role,status,created_at) VALUES (?,?,?,?, 'admin','active',?)
            ON CONFLICT(email) DO UPDATE SET name=excluded.name, role='admin', status='active', password_hash=excluded.password_hash, salt=excluded.salt`,
      args: [name, email, hash, salt, now]
    });
    console.log(`Admin juga tersinkron ke local.db: ${email}`);
  } catch (err) {
    console.warn('Catatan local.db:', err.message);
  }
}

if (passwordArg) {
  await saveAdmin(passwordArg);
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes('Kata sandi')) process.stdout.write(s); }; // sembunyikan ketikan
  rl.question('Kata sandi: ', async (pw) => {
    rl.close();
    console.log('');
    await saveAdmin(pw);
  });
}

