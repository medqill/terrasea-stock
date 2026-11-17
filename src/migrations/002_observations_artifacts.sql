CREATE TABLE IF NOT EXISTS regions(code TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stations(id TEXT PRIMARY KEY, lon REAL NOT NULL, lat REAL NOT NULL);

CREATE TABLE IF NOT EXISTS obs_ocean(
  station_id TEXT NOT NULL REFERENCES stations(id),
  date TEXT NOT NULL,
  chl REAL,
  sst REAL,
  uo REAL,
  vo REAL,
  api_key_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(station_id, date)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS obs_catch(
  region TEXT NOT NULL REFERENCES regions(code),
  month TEXT NOT NULL,
  fish_group TEXT NOT NULL CHECK (fish_group IN ('pelagis_besar','pelagis_kecil','demersal')),
  catch_kg REAL CHECK (catch_kg >= 0),
  api_key_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(region, month, fish_group)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS obs_catch_species(
  region TEXT NOT NULL REFERENCES regions(code),
  month TEXT NOT NULL,
  species TEXT NOT NULL,
  catch_kg REAL CHECK (catch_kg >= 0),
  api_key_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(region, month, species)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS obs_effort(
  region TEXT NOT NULL REFERENCES regions(code),
  month TEXT NOT NULL,
  gear TEXT NOT NULL,
  trips INTEGER CHECK (trips >= 0),
  api_key_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(region, month, gear)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS api_keys(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  scopes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS ingest_log(
  id INTEGER PRIMARY KEY,
  api_key_id INTEGER,
  endpoint TEXT NOT NULL,
  status INTEGER NOT NULL,
  rows INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts(
  name TEXT PRIMARY KEY,
  month TEXT,
  content TEXT NOT NULL,
  model_version TEXT,
  generated_at TEXT,
  is_fixture INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO regions VALUES ('karangantu','Karangantu'),('lebak','Lebak');

