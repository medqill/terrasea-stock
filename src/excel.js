import XLSX from 'xlsx';

// Cegah formula injection bila sel teks diawali = + - @ saat dibuka di Excel.
const safe = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function buildWorkbook(sheets, metadata) {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const rows = s.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, safe(v)])));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), s.name.slice(0, 31));
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Keterangan', 'Isi'], ...metadata]), 'Metadata');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
