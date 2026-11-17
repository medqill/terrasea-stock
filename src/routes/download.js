import { Router } from 'express';
import * as data from '../data.js';
import { db } from '../db.js';
import { buildWorkbook } from '../excel.js';
import { downloadLimiter } from '../middleware.js';
import { asyncHandler } from '../async-handler.js';

const r = Router();
const TYPES = {
  msy: 'MSY dan hasil tangkapan (ton/bulan)',
  sst: 'Suhu permukaan laut (°C)',
  chl: 'Klorofil-a (mg/m³)',
  current: 'Kecepatan dan arah arus',
  ecosystem: 'Ekosistem terumbu karang dan lamun'
};
const LIMITASI = [
  'Data tangkapan beresolusi wilayah dan bulanan; nilai zona adalah hasil alokasi, bukan pengukuran.',
  'Model dilatih pada rentang waktu terbatas; akurasi dilaporkan, bukan dijamin.',
  'Kelas kelimpahan bersifat relatif dan berbasis aturan.',
  'Hasil adalah alat bantu keputusan, bukan regulasi resmi.'
];

r.get('/download', downloadLimiter, asyncHandler(async (req, res) => {
  const { type, from, to, group } = req.query;
  if (!TYPES[type]) return res.status(400).json({ message: 'Jenis data tidak dikenal.' });
  for (const m of [from, to]) if (m !== undefined && m !== '' && !data.isMonth(m)) return res.status(400).json({ message: 'Periode harus berformat YYYY-MM.' });
  if (from && to && from > to) return res.status(400).json({ message: 'Periode awal tidak boleh setelah periode akhir.' });
  const useGroup = type === 'msy' && group && group !== 'all';
  if (useGroup && !data.GROUPS.includes(group)) return res.status(400).json({ message: 'Kelompok ikan tidak dikenal.' });

  const zones = await data.getZones();
  if (!zones) return res.status(404).json({ message: 'Data belum tersedia.' });
  const inRange = (m) => (!from || m >= from) && (!to || m <= to);
  const sheets = [];
  let fixture = zones.fixture;
  const modelMeta = await data.meta();

  if (type === 'ecosystem') {
    const e = await data.getEcosystem();
    if (!e) return res.status(404).json({ message: 'Data ekosistem belum tersedia.' });
    fixture ||= e.fixture;
    sheets.push({
      name: 'Ekosistem',
      rows: e.data.features.map((f, i) => ({
        No: i + 1, Jenis: f.properties.type === 'coral' ? 'Terumbu karang' : 'Lamun',
        Zona: f.properties.zone_id ?? '', Nama: f.properties.name ?? '', 'Luas (ha)': f.properties.area_ha ?? null
      }))
    });
  } else {
    const rows = [];
    for (const z of zones.data.features) {
      const f = await data.getForecast(z.properties.zone_id);
      if (!f) continue;
      fixture ||= f.fixture;
      if (type === 'msy') {
        for (const s of f.data.series.filter((x) => inRange(x.month))) {
          const g = useGroup ? s.by_group?.[group] : s;
          if (!g) continue;
          rows.push({
            Zona: z.properties.zone_id, Bulan: s.month, Jenis: s.kind === 'forecast' ? 'Forecast' : 'Hindcast',
            'Kelompok ikan': useGroup ? group : 'total',
            'Tangkapan aktual (ton)': g.actual_catch ?? null, 'Prediksi model (ton)': g.hindcast ?? null, 'MSY (ton/bulan)': g.msy ?? null
          });
        }
      } else {
        for (const p of f.data.params.filter((x) => inRange(x.month))) {
          if (type === 'sst') rows.push({ Zona: z.properties.zone_id, Bulan: p.month, 'SST (°C)': p.sst });
          if (type === 'chl') rows.push({ Zona: z.properties.zone_id, Bulan: p.month, 'Klorofil-a (mg/m³)': p.chl });
          if (type === 'current')
            rows.push({ Zona: z.properties.zone_id, Bulan: p.month, 'Kecepatan (m/s)': p.speed, 'Arah (derajat)': p.direction_deg, 'Arah mata angin': p.direction_label });
        }
      }
    }
    sheets.push({ name: type === 'msy' ? 'MSY' : 'Data', rows });
    if (type === 'msy') {
      const groups = useGroup ? [group] : data.GROUPS;
      const alloc = [];
      for (const z of zones.data.features)
        for (const g of groups)
          alloc.push({
            Zona: z.properties.zone_id, Nama: z.properties.name, Bulan: z.properties.month, 'Kelompok ikan': g,
            'MSY (ton/bulan)': z.properties.msy[g], 'TAC (ton/bulan)': z.properties.tac[g], Keterangan: 'Alokasi zona, bukan pengukuran'
          });
      sheets.push({ name: 'Alokasi zona', rows: alloc });
    }
  }
  if (!sheets[0].rows.length) return res.status(404).json({ message: 'Tidak ada data pada periode itu.' });

  const metadata = [
    ['Sumber', 'terrasea-stock, hasil olahan pipeline ml/ (data/processed)'],
    ['Jenis data', TYPES[type] + (useGroup ? `, kelompok ${group}` : '')],
    ['Periode', `${from || 'awal'} sampai ${to || 'akhir'}`],
    ['Versi model', modelMeta?.model_version ?? 'tidak diketahui'],
    ['Dihasilkan pada', modelMeta?.generated_at ?? 'tidak diketahui'],
    ...(fixture ? [['PERINGATAN', 'Berkas ini memuat data fixture (bukan hasil model sungguhan).']] : []),
    ...LIMITASI.map((t, i) => [`Limitasi ${i + 1}`, t])
  ];
  const buffer = buildWorkbook(sheets, metadata);

  await db.run(
    'INSERT INTO download_log(user_id,type,period_from,period_to,fish_group,created_at) VALUES (?,?,?,?,?,?)',
    [req.user.id, type, from || null, to || null, useGroup ? group : null, new Date().toISOString()]
  );

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="terrasea-stock_${type}_${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(buffer);
}));

export default r;
