import { Router } from 'express';
import { db } from '../db.js';
import { asyncHandler } from '../async-handler.js';
import { requireApiKey, logIngest } from '../middleware.js';
import { validateOcean, validateCatch, validateCatchSpecies, validateEffort } from '../ingest-schema.js';
import { validateArtifact, isKnownArtifactName, DGRID_NAME_RE } from '../contract.js';
import { ingestIpLimiter, ingestKeyLimiter } from '../ratelimit.js';

const r = Router();
r.use(ingestIpLimiter);

function getRows(req) {
  if (Array.isArray(req.body)) return req.body;
  if (Array.isArray(req.body?.rows)) return req.body.rows;
  return null;
}

// Satu pabrik untuk keempat endpoint baris observasi (perilaku sama dengan versi sebelumnya).
function rowRoute(path, { validate, sql, args }) {
  r.post(path, requireApiKey('observations:write'), ingestKeyLimiter, asyncHandler(async (req, res) => {
    const rows = getRows(req);
    if (!rows || rows.length === 0) {
      await logIngest(req.apiKey.id, req.originalUrl, 400, 0, 'Data rows kosong atau bukan array');
      return res.status(400).json({ message: 'Payload harus berupa array atau memiliki properti "rows" yang tidak kosong.' });
    }
    if (rows.length > 500) {
      await logIngest(req.apiKey.id, req.originalUrl, 400, rows.length, 'Melebihi batas 500 baris');
      return res.status(400).json({ message: 'Maksimum 500 baris per panggilan.' });
    }
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const check = validate(rows[i], i + 1);
      if (!check.valid) errors.push(...check.errors);
    }
    if (errors.length > 0) {
      await logIngest(req.apiKey.id, req.originalUrl, 400, 0, `Validasi gagal pada ${errors.length} baris`);
      return res.status(400).json({ message: 'Validasi data gagal.', errors });
    }
    await db.tx(rows.map((row) => ({ sql, args: args(row, req.apiKey.id) })));
    await logIngest(req.apiKey.id, req.originalUrl, 200, rows.length, 'Sukses');
    res.status(200).json({ success: true, count: rows.length });
  }));
}

rowRoute('/ocean', {
  validate: validateOcean,
  sql: `INSERT INTO obs_ocean (station_id, date, chl, sst, uo, vo, api_key_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(station_id, date) DO UPDATE SET
          chl=excluded.chl, sst=excluded.sst, uo=excluded.uo, vo=excluded.vo,
          api_key_id=excluded.api_key_id, updated_at=datetime('now')`,
  args: (row, keyId) => [row.station_id, row.date, row.chl ?? null, row.sst ?? null, row.uo ?? null, row.vo ?? null, keyId]
});

rowRoute('/catch', {
  validate: validateCatch,
  sql: `INSERT INTO obs_catch (region, month, fish_group, catch_kg, api_key_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(region, month, fish_group) DO UPDATE SET
          catch_kg=excluded.catch_kg, api_key_id=excluded.api_key_id, updated_at=datetime('now')`,
  args: (row, keyId) => [row.region.toLowerCase(), row.month, row.fish_group.toLowerCase(), Number(row.catch_kg), keyId]
});

rowRoute('/catch-species', {
  validate: validateCatchSpecies,
  sql: `INSERT INTO obs_catch_species (region, month, species, catch_kg, api_key_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(region, month, species) DO UPDATE SET
          catch_kg=excluded.catch_kg, api_key_id=excluded.api_key_id, updated_at=datetime('now')`,
  args: (row, keyId) => [row.region.toLowerCase(), row.month, row.species, Number(row.catch_kg), keyId]
});

rowRoute('/effort', {
  validate: validateEffort,
  sql: `INSERT INTO obs_effort (region, month, gear, trips, api_key_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(region, month, gear) DO UPDATE SET
          trips=excluded.trips, api_key_id=excluded.api_key_id, updated_at=datetime('now')`,
  args: (row, keyId) => [row.region.toLowerCase(), row.month, row.gear, Number(row.trips), keyId]
});

// GET /api/ingest/export - ekspor observasi mentah berhalaman untuk pipeline ML
r.get('/export', requireApiKey('observations:read'), ingestKeyLimiter, asyncHandler(async (req, res) => {
  const { type = 'ocean', limit = 500, offset = 0, region, station_id, from, to } = req.query;
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const off = Math.max(Number(offset) || 0, 0);
  const params = [];
  let query = '';

  const monthly = (table, cols) => {
    let where = 'WHERE 1=1';
    if (region) { where += ' AND region=?'; params.push(region); }
    if (from) { where += ' AND month >= ?'; params.push(from); }
    if (to) { where += ' AND month <= ?'; params.push(to); }
    return `SELECT ${cols}, updated_at FROM ${table} ${where} ORDER BY month ASC, region ASC LIMIT ? OFFSET ?`;
  };

  if (type === 'ocean') {
    let where = 'WHERE 1=1';
    if (station_id) { where += ' AND station_id=?'; params.push(station_id); }
    if (from) { where += ' AND date >= ?'; params.push(from); }
    if (to) { where += ' AND date <= ?'; params.push(to); }
    query = `SELECT station_id, date, chl, sst, uo, vo, updated_at FROM obs_ocean ${where} ORDER BY date ASC, station_id ASC LIMIT ? OFFSET ?`;
  } else if (type === 'catch') query = monthly('obs_catch', 'region, month, fish_group, catch_kg');
  else if (type === 'catch_species') query = monthly('obs_catch_species', 'region, month, species, catch_kg');
  else if (type === 'effort') query = monthly('obs_effort', 'region, month, gear, trips');
  else return res.status(400).json({ message: "Parameter type tidak valid. Pilihan: 'ocean', 'catch', 'catch_species', 'effort'." });

  params.push(lim, off);
  const rows = await db.query(query, params);
  res.json({ type, limit: lim, offset: off, count: rows.length, data: rows });
}));

// PUT /api/ingest/artifacts/:name - publikasi hasil pipeline ML ke tabel artifacts.
// (GET artifacts dihapus: tidak terautentikasi dan memakai db.get yang tidak ada.
//  Pembacaan untuk klien lewat /api/ocean-window dan /api/dgrids/:var di routes/map.js, di balik requireAuth.)
r.put('/artifacts/:name', requireApiKey('artifacts:write'), ingestKeyLimiter, asyncHandler(async (req, res) => {
  const { name } = req.params;
  const { content, model_version, generated_at, month, is_fixture = 0 } = req.body || {};

  if (!isKnownArtifactName(name)) {
    await logIngest(req.apiKey.id, req.originalUrl, 400, 0, 'Nama artifact di luar pola');
    return res.status(400).json({ message: 'Nama artifact tidak dikenal. Lihat docs/PIPELINE_CONTRACT.md.' });
  }
  if (!content) {
    await logIngest(req.apiKey.id, req.originalUrl, 400, 0, 'Konten artifact kosong');
    return res.status(400).json({ message: 'Field "content" wajib diisi.' });
  }
  let parsedContent = content;
  if (typeof content === 'string') {
    try { parsedContent = JSON.parse(content); } catch {
      await logIngest(req.apiKey.id, req.originalUrl, 400, 0, 'JSON string content tidak valid');
      return res.status(400).json({ message: 'Konten bukan JSON yang valid.' });
    }
  }
  const validation = validateArtifact(name, parsedContent);
  if (!validation.valid) {
    await logIngest(req.apiKey.id, req.originalUrl, 400, 0, `Validasi kontrak gagal: ${validation.errors.join('; ')}`);
    return res.status(400).json({ message: 'Validasi kontrak artifact gagal.', errors: validation.errors });
  }
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
  await db.run(
    `INSERT INTO artifacts (name, month, content, model_version, generated_at, is_fixture, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(name) DO UPDATE SET
       month=excluded.month, content=excluded.content, model_version=excluded.model_version,
       generated_at=excluded.generated_at, is_fixture=excluded.is_fixture, updated_at=datetime('now')`,
    [name, month || null, contentStr, model_version || null, generated_at || null, is_fixture ? 1 : 0]
  );
  await logIngest(req.apiKey.id, req.originalUrl, 200, 1, `Artifact "${name}" tersimpan`);
  res.json({ success: true, name });
}));

// DELETE /api/ingest/artifacts/:name - hanya untuk pembersihan dgrid:{var}:{YYYY-MM-DD}
r.delete('/artifacts/:name', requireApiKey('artifacts:write'), ingestKeyLimiter, asyncHandler(async (req, res) => {
  const { name } = req.params;
  if (!DGRID_NAME_RE.test(name)) {
    await logIngest(req.apiKey.id, req.originalUrl, 400, 0, 'Hapus ditolak: bukan dgrid');
    return res.status(400).json({ message: 'Hanya artifact berpola dgrid:{var}:{YYYY-MM-DD} yang boleh dihapus.' });
  }
  const result = await db.run('DELETE FROM artifacts WHERE name = ?', [name]);
  if (result.changes === 0) {
    await logIngest(req.apiKey.id, req.originalUrl, 404, 0, 'Artifact tidak ada');
    return res.status(404).json({ message: 'Artifact tidak ditemukan.' });
  }
  await logIngest(req.apiKey.id, req.originalUrl, 200, 1, `Artifact "${name}" dihapus`);
  res.json({ success: true, name });
}));

r.use((req, res) => {
  res.status(404).json({ message: 'Endpoint ingest tidak ditemukan.' });
});

export default r;