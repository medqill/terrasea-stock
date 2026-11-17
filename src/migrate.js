import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { client as defaultClient } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migDir = path.join(here, 'migrations');

export async function runMigrations(client = defaultClient) {
  await client.execute(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)'
  );

  const applied = [];
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const existing = await client.execute({
      sql: 'SELECT 1 FROM schema_migrations WHERE name = ?',
      args: [file]
    });
    if (existing.rows.length > 0) continue;

    const sqlContent = fs.readFileSync(path.join(migDir, file), 'utf8');
    await client.executeMultiple(sqlContent);
    await client.execute({
      sql: 'INSERT INTO schema_migrations(name, applied_at) VALUES (?, ?)',
      args: [file, new Date().toISOString()]
    });
    applied.push(file);
  }

  return applied;
}

