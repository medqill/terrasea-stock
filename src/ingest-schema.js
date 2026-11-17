// Skema dan aturan validasi untuk ingest dan import data observasi mentah.
// Catatan: batasan nilai variabel disesuaikan dengan domain pesisir Banten.
// TODO: konfirmasi Devina/Nazma mengenai ambang batas ekologis dan daftar spesies final.

export const REGIONS = ['karangantu', 'lebak'];
export const FISH_GROUPS = ['pelagis_besar', 'pelagis_kecil', 'demersal'];

export const VALIDATION_LIMITS = {
  sst: { min: 15, max: 35 },
  chl: { min: 0, max: 50 },
  uo: { min: -5, max: 5 },
  vo: { min: -5, max: 5 }
};

export const SLUG_REGEX = /^[a-z0-9_]{1,40}$/;
export const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isValidMonth(m) {
  return typeof m === 'string' && MONTH_REGEX.test(m);
}

export function isValidDate(d) {
  if (typeof d !== 'string' || !DATE_REGEX.test(d)) return false;
  // Jangan terima tanggal masa depan
  const today = new Date().toISOString().slice(0, 10);
  return d <= today;
}

export function validateOceanRow(row, idx) {
  const errs = [];
  const prefix = idx != null ? `Baris ${idx}: ` : '';

  if (!row.station_id || typeof row.station_id !== 'string') {
    errs.push(`${prefix}station_id wajib diisi`);
  }
  if (!isValidDate(row.date)) {
    errs.push(`${prefix}date tidak valid atau di masa depan (${row.date})`);
  }

  for (const k of ['chl', 'sst', 'uo', 'vo']) {
    const val = row[k];
    if (val !== null && val !== undefined && val !== '') {
      const num = Number(val);
      if (Number.isNaN(num)) {
        errs.push(`${prefix}${k} harus berupa angka atau null`);
      } else {
        const lim = VALIDATION_LIMITS[k];
        if (num < lim.min || num > lim.max) {
          errs.push(`${prefix}${k} bernilai ${num}, di luar rentang ${lim.min}..${lim.max}`);
        }
      }
    }
  }

  return { valid: errs.length === 0, errors: errs };
}

export function validateCatchRow(row, idx) {
  const errs = [];
  const prefix = idx != null ? `Baris ${idx}: ` : '';

  if (!REGIONS.includes(row.region)) {
    errs.push(`${prefix}region tidak dikenal: ${row.region}`);
  }
  if (!isValidMonth(row.month)) {
    errs.push(`${prefix}month harus berformat YYYY-MM: ${row.month}`);
  }
  if (!FISH_GROUPS.includes(row.fish_group)) {
    errs.push(`${prefix}fish_group tidak dikenal: ${row.fish_group}`);
  }
  if (row.catch_kg === null || row.catch_kg === undefined || Number.isNaN(Number(row.catch_kg)) || Number(row.catch_kg) < 0) {
    errs.push(`${prefix}catch_kg harus bilangan >= 0`);
  }

  return { valid: errs.length === 0, errors: errs };
}

export function validateCatchSpeciesRow(row, idx) {
  const errs = [];
  const prefix = idx != null ? `Baris ${idx}: ` : '';

  if (!REGIONS.includes(row.region)) {
    errs.push(`${prefix}region tidak dikenal: ${row.region}`);
  }
  if (!isValidMonth(row.month)) {
    errs.push(`${prefix}month harus berformat YYYY-MM: ${row.month}`);
  }
  if (!row.species || !SLUG_REGEX.test(row.species)) {
    errs.push(`${prefix}species harus slug [a-z0-9_] maks 40 char: ${row.species}`);
  }
  if (row.catch_kg !== null && row.catch_kg !== undefined) {
    const num = Number(row.catch_kg);
    if (Number.isNaN(num) || num < 0) {
      errs.push(`${prefix}catch_kg harus bilangan >= 0 atau null`);
    }
  }

  return { valid: errs.length === 0, errors: errs };
}

export function validateEffortRow(row, idx) {
  const errs = [];
  const prefix = idx != null ? `Baris ${idx}: ` : '';

  if (!REGIONS.includes(row.region)) {
    errs.push(`${prefix}region tidak dikenal: ${row.region}`);
  }
  if (!isValidMonth(row.month)) {
    errs.push(`${prefix}month harus berformat YYYY-MM: ${row.month}`);
  }
  if (!row.gear || !SLUG_REGEX.test(row.gear)) {
    errs.push(`${prefix}gear harus slug [a-z0-9_] maks 40 char: ${row.gear}`);
  }
  if (row.trips !== null && row.trips !== undefined) {
    const num = Number(row.trips);
    if (Number.isNaN(num) || !Number.isInteger(num) || num < 0) {
      errs.push(`${prefix}trips harus bilangan bulat >= 0 atau null`);
    }
  }

  return { valid: errs.length === 0, errors: errs };
}

export const validateOcean = validateOceanRow;
export const validateCatch = validateCatchRow;
export const validateCatchSpecies = validateCatchSpeciesRow;
export const validateEffort = validateEffortRow;
