import 'dotenv/config';
import { runMigrations } from '../src/migrate.js';

try {
  const applied = await runMigrations();
  if (applied.length === 0) {
    console.log('Semua migrasi sudah terpasang.');
  } else {
    for (const name of applied) {
      console.log(`Migrasi berhasil diterapkan: ${name}`);
    }
  }
} catch (err) {
  console.error('Migrasi gagal:', err.message);
  process.exit(1);
}

