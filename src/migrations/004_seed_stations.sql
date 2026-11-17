-- Seed 6 titik stasiun pengamatan oseanografi pesisir Banten.
-- Koordinat sesuai bot/copernicus_bot.py dan docs/ARCHITECTURE.md.
INSERT OR IGNORE INTO stations (id, lon, lat) VALUES
  ('titik_1', 106.0994, -7.2230),
  ('titik_2', 105.2976, -7.0236),
  ('titik_3', 104.9594, -6.6195),
  ('titik_4', 105.6083, -6.5007),
  ('titik_5', 105.6736, -5.9519),
  ('titik_6', 106.6378, -5.7564);
