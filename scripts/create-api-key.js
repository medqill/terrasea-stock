// Buat kunci API bot dengan scope tertentu.
// Pakai: node scripts/create-api-key.js --name "Nama Bot" --scopes "observations:write,observations:read"
// atau:  npm run create-api-key -- "Nama Bot" "observations:write,observations:read"
import 'dotenv/config';
import crypto from 'node:crypto';
import { db } from '../src/db.js';

const args = process.argv.slice(2);
let name = '';
let scopes = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name' && args[i + 1]) {
    name = args[++i];
  } else if (args[i] === '--scopes' && args[i + 1]) {
    scopes = args[++i];
  } else if (!name) {
    name = args[i];
  } else if (!scopes) {
    scopes = args[i];
  }
}

if (!name) {
  console.error('Penggunaan: node scripts/create-api-key.js --name "Nama Bot" [--scopes "observations:write,observations:read"]');
  process.exit(1);
}

const defaultScopes = 'observations:write,observations:read,artifacts:write';
const finalScopes = scopes || defaultScopes;
const rawKey = `tsk_${crypto.randomBytes(24).toString('hex')}`;
const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

try {
  const res = await db.run(
    "INSERT INTO api_keys (name, key_hash, scopes, created_at) VALUES (?, ?, ?, datetime('now'))",
    [name.trim(), keyHash, finalScopes.trim()]
  );

  const id = res.lastInsertRowid ?? res.last_insert_rowid;
  console.log('\n======================================================');
  console.log(' KUNCI API BOT BERHASIL DIBUAT');
  console.log('======================================================');
  console.log(`ID     : ${id}`);
  console.log(`Nama   : ${name}`);
  console.log(`Scopes : ${finalScopes}`);
  console.log(`Kunci  : ${rawKey}`);
  console.log('------------------------------------------------------');
  console.log('PERHATIAN: Salin dan simpan kunci ini sekarang.');
  console.log('Kunci ini tidak akan disimpan dalam bentuk teks biasa dan');
  console.log('tidak dapat ditampilkan kembali di lain waktu.');
  console.log('======================================================\n');
} catch (err) {
  console.error('Gagal membuat kunci API:', err.message);
  process.exit(1);
}

