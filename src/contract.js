// Validasi kontrak data olahan (artifacts) sesuai docs/ARCHITECTURE.md bagian 5
// dan docs/PIPELINE_CONTRACT.md (ocean_window, dgrid).
const GROUPS = ['pelagis_besar', 'pelagis_kecil', 'demersal'];
const OCEAN_VARS = ['sst', 'chl', 'current'];
const GRID_VARS = ['sst', 'chl', 'current', 'bathymetry'];
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// Nama kanonik dgrid memakai ':' sebagai pemisah. Grup kedua = tanggal.
export const DGRID_NAME_RE = /^dgrid:(sst|chl|current):(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))$/;

/** Daftar putih nama artifact yang boleh ditulis lewat PUT /api/ingest/artifacts/:name. */
export function isKnownArtifactName(name) {
  if (typeof name !== 'string') return false;
  return (
    ['zones', 'ecosystem', 'ocean_window', 'grid:bathymetry'].includes(name) ||
    /^forecast:Z-\d{2}$/.test(name) ||
    /^grid:(sst|chl|current|bathymetry):\d{4}-(0[1-9]|1[0-2])$/.test(name) ||
    /^grid:bathymetry$/.test(name) ||
    /^abundance:\d{4}-(0[1-9]|1[0-2])$/.test(name) ||
    DGRID_NAME_RE.test(name)
  );
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isDate = (s) => typeof s === 'string' && DATE_RE.test(s);
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 864e5);

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function need(obj, keys, where, errors) {
  for (const k of keys) {
    if (obj?.[k] === undefined || obj?.[k] === null) {
      errors.push(`${where}: field "${k}" wajib ada`);
    }
  }
}

function validateDgrid(name, c, errors) {
  const m = DGRID_NAME_RE.exec(name);
  if (!m) {
    errors.push(`dgrid: nama '${name}' harus berpola dgrid:(sst|chl|current):YYYY-MM-DD`);
    return;
  }
  const [, variable, date] = m;
  const w = `dgrid:${variable}:${date}`;
  need(c, ['var', 'unit', 'date', 'kind', 'bbox', 'nx', 'ny', 'values', 'vmin', 'vmax', 'model_version', 'generated_at'], w, errors);
  if (c.var !== undefined && c.var !== variable) errors.push(`${w}: field var (${c.var}) tidak cocok dengan nama`);
  if (c.date !== undefined && c.date !== date) errors.push(`${w}: field date (${c.date}) tidak cocok dengan nama`);
  if (c.kind !== undefined && !['observed', 'forecast'].includes(c.kind)) errors.push(`${w}: kind harus 'observed' atau 'forecast'`);
  if (c.bbox !== undefined) {
    const b = c.bbox;
    if (!Array.isArray(b) || b.length !== 4 || !b.every(isNum) || b[0] >= b[2] || b[1] >= b[3]) {
      errors.push(`${w}: bbox harus [barat, selatan, timur, utara] dengan barat<timur dan selatan<utara`);
    }
  }
  if (c.vmin !== undefined && c.vmax !== undefined && !(isNum(c.vmin) && isNum(c.vmax) && c.vmin <= c.vmax)) {
    errors.push(`${w}: vmin/vmax harus angka dengan vmin <= vmax`);
  }
  if (!Number.isInteger(c.nx) || !Number.isInteger(c.ny) || c.nx < 1 || c.ny < 1) {
    errors.push(`${w}: nx dan ny harus bilangan bulat positif`);
    return;
  }
  const n = c.nx * c.ny;
  const checkArr = (key, nonNegative) => {
    const a = c[key];
    if (a === undefined || a === null) {
      if (key !== 'values') errors.push(`${w}: field "${key}" wajib ada untuk current`);
      return;
    }
    if (!Array.isArray(a)) { errors.push(`${w}: ${key} harus array`); return; }
    if (a.length !== n) errors.push(`${w}: panjang ${key} (${a.length}) != nx*ny (${n})`);
    for (const v of a) {
      if (v === null) continue;
      if (!isNum(v)) { errors.push(`${w}: ${key} memuat nilai bukan angka`); break; }
      if (nonNegative && v < 0) { errors.push(`${w}: ${key} memuat nilai negatif`); break; }
    }
  };
  checkArr('values', variable !== 'sst'); // chl dan kecepatan arus tidak boleh negatif
  if (variable === 'current') { checkArr('uo', false); checkArr('vo', false); }
}

function validateOceanWindow(c, errors) {
  const w = 'ocean_window';
  need(c, ['reference_date', 'data_through', 'stale', 'days', 'scale', 'metrics', 'idw', 'model_version', 'generated_at'], w, errors);
  const refOk = isDate(c.reference_date);
  const thrOk = isDate(c.data_through);
  if (c.reference_date != null && !refOk) errors.push(`${w}.reference_date harus YYYY-MM-DD`);
  if (c.data_through != null && !thrOk) errors.push(`${w}.data_through harus YYYY-MM-DD`);

  if (c.stale != null) {
    if (typeof c.stale !== 'boolean') errors.push(`${w}.stale harus boolean`);
    else if (refOk && thrOk && c.stale !== (dayDiff(c.reference_date, c.data_through) > 7)) {
      errors.push(`${w}.stale tidak konsisten: harus true bila reference_date - data_through > 7 hari`);
    }
  }

  if (c.days != null) {
    if (!Array.isArray(c.days) || c.days.length !== 7) {
      errors.push(`${w}.days harus berisi tepat 7 entri (H-3..H+3)`);
    } else {
      c.days.forEach((d, i) => {
        const dw = `${w}.days[${i}]`;
        if (!d || typeof d !== 'object') { errors.push(`${dw}: harus objek`); return; }
        need(d, ['date', 'offset', 'kind'], dw, errors);
        if (!('horizon_days' in d)) errors.push(`${dw}: field "horizon_days" wajib ada (null bila observed)`);
        if (d.offset !== i - 3) errors.push(`${dw}: offset harus ${i - 3}`);
        if (!['observed', 'forecast'].includes(d.kind)) errors.push(`${dw}: kind harus 'observed' atau 'forecast'`);
        if (refOk && isDate(d.date) && d.date !== addDays(c.reference_date, d.offset)) {
          errors.push(`${dw}: date harus reference_date ${d.offset >= 0 ? '+' : ''}${d.offset} hari`);
        }
        if (thrOk && isDate(d.date)) {
          const expected = d.date <= c.data_through ? 'observed' : 'forecast';
          if (d.kind !== expected) errors.push(`${dw}: kind harus '${expected}' untuk tanggal ${d.date}`);
          if (expected === 'observed' && d.horizon_days !== null) errors.push(`${dw}: horizon_days harus null untuk observed`);
          if (expected === 'forecast' && d.horizon_days !== dayDiff(d.date, c.data_through)) {
            errors.push(`${dw}: horizon_days harus ${dayDiff(d.date, c.data_through)}`);
          }
        }
      });
    }
  }

  if (c.scale != null) {
    for (const v of OCEAN_VARS) {
      const s = c.scale[v];
      if (!s) { errors.push(`${w}.scale.${v} tidak ada`); continue; }
      need(s, ['vmin', 'vmax', 'unit'], `${w}.scale.${v}`, errors);
      if (isNum(s.vmin) && isNum(s.vmax) && !(s.vmin < s.vmax)) errors.push(`${w}.scale.${v}: vmin harus < vmax`);
    }
  }

  if (c.metrics != null) {
    if (!Array.isArray(c.metrics)) errors.push(`${w}.metrics harus array`);
    else c.metrics.forEach((m, i) => {
      const mw = `${w}.metrics[${i}]`;
      need(m, ['var', 'horizon_days', 'rmse', 'mae', 'baseline_persistence_rmse', 'baseline_climatology_rmse'], mw, errors);
      if (m?.var !== undefined && !OCEAN_VARS.includes(m.var)) errors.push(`${mw}.var harus sst, chl, atau current`);
      for (const k of ['rmse', 'mae', 'baseline_persistence_rmse', 'baseline_climatology_rmse']) {
        if (m?.[k] != null && (!isNum(m[k]) || m[k] < 0)) errors.push(`${mw}.${k} harus angka >= 0`);
      }
    });
  }

  if (c.idw != null) {
    need(c.idw, ['power', 'max_distance_km', 'loocv'], `${w}.idw`, errors);
    if (c.idw.loocv) {
      for (const v of OCEAN_VARS) {
        if (!c.idw.loocv[v]) errors.push(`${w}.idw.loocv.${v} tidak ada`);
        else need(c.idw.loocv[v], ['rmse'], `${w}.idw.loocv.${v}`, errors);
      }
    }
  }
}

/**
 * Validasi artifact berdasarkan nama dan konten JSON-nya.
 * @param {string} name - mis. 'zones', 'forecast:Z-01', 'grid:sst:2026-03', 'abundance:2026-03',
 *                        'ocean_window', 'dgrid:sst:2026-11-10'
 * @param {any} content
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateArtifact(name, content) {
  const errors = [];
  if (!content || typeof content !== 'object') {
    return { valid: false, errors: ['Konten artifact harus berupa objek atau array JSON yang valid.'] };
  }

  // Nama lama bisa memakai '_' sebagai pemisah; 'ocean_window' adalah nama sebenarnya.
  const normName = name === 'ocean_window' ? name : name.replace(/_/g, ':');

  if (normName === 'zones' || normName.startsWith('zones:')) {
    if (!content.features || !Array.isArray(content.features)) {
      errors.push('zones: harus memiliki properti "features" bertipe array');
    } else {
      const n = content.features.length;
      if (n < 2 || n > 7) errors.push(`zones: jumlah zona ${n}, harus antara 2 s.d. 7`);
      for (const f of content.features) {
        const p = f.properties;
        const w = `zones ${p?.zone_id || '?'}`;
        need(p, ['zone_id', 'name', 'area_ha', 'touches_coast', 'month', 'msy', 'tac', 'abundance', 'season', 'model_version', 'generated_at'], w, errors);
        if (p) {
          if (typeof p.area_ha !== 'number' || p.area_ha <= 0) {
            errors.push(`${w}: area_ha (${p.area_ha}) harus berupa angka > 0`);
          }
          if (p.touches_coast !== true) errors.push(`${w}: touches_coast harus true`);
          for (const g of [...GROUPS, 'total']) {
            if (typeof p.msy?.[g] !== 'number' || p.msy[g] < 0) errors.push(`${w}: msy.${g} harus berupa angka >= 0`);
            if (typeof p.tac?.[g] !== 'number' || p.tac[g] < 0) errors.push(`${w}: tac.${g} harus berupa angka >= 0`);
          }
          for (const g of GROUPS) {
            if (!['high', 'mid', 'low'].includes(p.abundance?.[g])) {
              errors.push(`${w}: abundance.${g} harus bernilai 'high', 'mid', atau 'low'`);
            }
          }
        }
      }
    }
  } else if (normName === 'ecosystem') {
    if (!content.features || !Array.isArray(content.features)) {
      errors.push('ecosystem: harus memiliki properti "features" bertipe array');
    } else {
      content.features.forEach((f, i) => {
        if (!['coral', 'seagrass'].includes(f.properties?.type)) {
          errors.push(`ecosystem #${i}: properties.type harus bernilai 'coral' atau 'seagrass'`);
        }
      });
    }
  } else if (normName.startsWith('forecast:')) {
    const zoneId = normName.split(':')[1];
    need(content, ['zone_id', 'model_version', 'generated_at', 'metrics', 'series', 'params'], `forecast ${zoneId}`, errors);
    if (content.metrics) need(content.metrics, ['rmse', 'mae', 'n_test'], `forecast ${zoneId}.metrics`, errors);
    if (Array.isArray(content.series)) {
      let hasForecast = false;
      for (const s of content.series) {
        if (!['hindcast', 'forecast'].includes(s.kind)) errors.push(`forecast ${zoneId} (${s.month}): kind harus 'hindcast' atau 'forecast'`);
        if (s.kind === 'forecast') hasForecast = true;
        for (const v of [s.hindcast, s.msy, s.actual_catch]) {
          if (v !== null && v !== undefined && (typeof v !== 'number' || v < 0)) {
            errors.push(`forecast ${zoneId} (${s.month}): nilai metrik tidak boleh negatif`);
          }
        }
      }
      if (!hasForecast) errors.push(`forecast ${zoneId}: wajib memiliki minimal satu baris bertipe 'forecast'`);
    } else {
      errors.push(`forecast ${zoneId}: series harus berupa array`);
    }
  } else if (normName === 'ocean_window') {
    validateOceanWindow(content, errors);
  } else if (normName.startsWith('dgrid:')) {
    validateDgrid(name, content, errors);
  } else if (normName.startsWith('grid:')) {
    const v = normName.split(':')[1];
    if (!GRID_VARS.includes(v)) errors.push(`grid: jenis variabel '${v}' tidak dikenali (harus sst, chl, current, atau bathymetry)`);
    need(content, ['nx', 'ny', 'bbox', 'unit', 'vmin', 'vmax', 'values'], `grid ${v}`, errors);
    if (Array.isArray(content.values) && typeof content.nx === 'number' && typeof content.ny === 'number') {
      if (content.values.length !== content.nx * content.ny) {
        errors.push(`grid ${v}: panjang values (${content.values.length}) != nx * ny (${content.nx * content.ny})`);
      }
    }
  } else if (normName.startsWith('abundance:')) {
    need(content, ['nx', 'ny', 'groups'], 'abundance', errors);
    if (content.groups && typeof content.nx === 'number' && typeof content.ny === 'number') {
      const expectedLen = content.nx * content.ny;
      for (const g of GROUPS) {
        if (!Array.isArray(content.groups[g]) || content.groups[g].length !== expectedLen) {
          errors.push(`abundance ${g}: panjang array tidak cocok dengan nx * ny`);
        }
      }
    }
  } else {
    errors.push(`Nama artifact '${name}' tidak dikenali.`);
  }

  return { valid: errors.length === 0, errors };
}
