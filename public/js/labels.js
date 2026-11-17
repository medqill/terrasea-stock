import { h } from './dom.js';

export const GROUPS = [
  { key: 'pelagis_besar', label: 'Pelagis besar', contoh: 'Tuna, cakalang, tongkol' },
  { key: 'pelagis_kecil', label: 'Pelagis kecil', contoh: 'Lemuru, kembung, teri' },
  { key: 'demersal', label: 'Demersal', contoh: 'Kakap, kerapu, bawal' }
];
const ABUND = { high: ['▲', 'Sangat berlimpah'], mid: ['=', 'Berlimpah'], low: ['▼', 'Kurang berlimpah'] };

/** Simbol + warna + teks, tidak pernah warna saja. */
export function abundBadge(cls) {
  const [sym, text] = ABUND[cls] || ['–', 'Tidak tersedia'];
  return h('span', { class: `abund abund--${ABUND[cls] ? cls : 'none'}` }, h('span', { class: 'abund__sym', 'aria-hidden': 'true' }, sym), h('span', {}, text));
}
const DIRS = ['Utara', 'Timur Laut', 'Timur', 'Tenggara', 'Selatan', 'Barat Daya', 'Barat', 'Barat Laut'];
export const dirLabel = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
export const fmt = (n, d = 1) => (n == null ? '–' : Number(n).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const fmtMonth = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
export const fmtDate = (iso) => new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
export const fixtureChip = () => h('span', { class: 'chip chip--fixture', title: 'Bukan hasil model sungguhan' }, 'Data fixture');
export const LIMITASI = [
  'Data tangkapan beresolusi wilayah dan bulanan; nilai zona adalah hasil alokasi, bukan pengukuran.',
  'Model dilatih pada rentang waktu terbatas; akurasi dilaporkan, bukan dijamin.',
  'Kelas kelimpahan bersifat relatif dan berbasis aturan.',
  'Hasil adalah alat bantu keputusan, bukan regulasi resmi.'
];
