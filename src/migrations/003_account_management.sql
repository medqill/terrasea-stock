PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS users_temp (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','inactive')),
  created_at TEXT NOT NULL
);

INSERT INTO users_temp (id, name, email, password_hash, salt, role, status, created_at)
  SELECT id, name, email, password_hash, salt, role, status, created_at FROM users;

DROP TABLE users;

ALTER TABLE users_temp RENAME TO users;

PRAGMA foreign_keys = ON;

