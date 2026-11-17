// Pembersihan artifact dgrid:* lama. Tanggal dibaca dari NAMA artifact (bukan generated_at)
// supaya hasilnya tidak bergantung pada kapan pipeline dijalankan ulang.
import { DGRID_NAME_RE, addDays } from './contract.js';

export const todayJakarta = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);

/** Hapus dgrid:* yang tanggalnya lebih tua dari keepDays hari. Mengembalikan jumlah yang dihapus. */
export async function cleanupOldDgrids(db, { today = todayJakarta(), keepDays = 14 } = {}) {
  const cutoff = addDays(today, -keepDays);
  const rows = await db.query("SELECT name FROM artifacts WHERE name LIKE 'dgrid:%'");
  const old = rows.map((r) => r.name).filter((n) => {
    const m = DGRID_NAME_RE.exec(n);
    return m && m[2] < cutoff;
  });
  if (old.length === 0) return 0;
  await db.tx(old.map((name) => ({ sql: 'DELETE FROM artifacts WHERE name = ?', args: [name] })));
  return old.length;
}
