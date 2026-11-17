import 'dotenv/config';
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';

// Turso libSQL client. Fallback lokal ke file:data/local.db
const url = process.env.TURSO_DATABASE_URL || 'file:data/local.db';
const authToken = process.env.TURSO_AUTH_TOKEN;

if (url.startsWith('file:')) {
  const filePath = url.slice(5);
  const dir = path.dirname(filePath);
  if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
}

export const client = createClient({ url, authToken });

export async function query(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows;
}

export async function one(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows[0] ?? null;
}

export async function run(sql, args = []) {
  const res = await client.execute({ sql, args });
  return {
    changes: res.rowsAffected,
    lastInsertRowid: res.lastInsertRowid != null ? Number(res.lastInsertRowid) : null
  };
}

export async function tx(statements) {
  return await client.batch(statements, 'write');
}

export const db = { client, query, one, run, tx };
