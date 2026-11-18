"""
Bot Pengunduh Data Oseanografi Copernicus Marine Service (CMEMS)
Sistem WebGIS Terrasea-Stock - Pesisir Banten

Dataset yang diunduh:
1. Chl-a : cmems_mod_glo_bgc-pft_anfc_0.25deg_P1D-m  (var: chl)
2. SST   : cmems_mod_glo_phy-thetao_anfc_0.083deg_P1D-m (var: thetao)
3. SWV   : cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m   (var: uo, vo)

Titik Pengamatan (6 Titik):
- Titik 1: Lon=106.0994, Lat=-7.2230
- Titik 2: Lon=105.2976, Lat=-7.0236
- Titik 3: Lon=104.9594, Lat=-6.6195
- Titik 4: Lon=105.6083, Lat=-6.5007
- Titik 5: Lon=105.6736, Lat=-5.9519
- Titik 6: Lon=106.6378, Lat=-5.7564

Segitiga Interpolasi:
- Area Bawah Banten: (1, 2, 4) dan (2, 3, 4)
- Area Atas Banten : (3, 4, 5) dan (4, 5, 6)

Mendukung 2 mode operasional:
- Mode Sekali Jalan (Online / GitHub Actions / Cron): --mode once
- Mode Daemon (Offline / Background Service)       : --mode daemon --interval 6
"""

import os
import sys
import time
import argparse
import datetime
import math
import logging
from pathlib import Path
import pandas as pd
import requests
from dotenv import load_dotenv

# Muat environment dari .env di root proyek jika ada
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("copernicus-bot")

# Konfigurasi Titik Stasiun Pengamatan
STATIONS = [
    {"id": "titik_1", "lon": 106.0994, "lat": -7.2230, "name": "Titik 1 (Banten Selatan)"},
    {"id": "titik_2", "lon": 105.2976, "lat": -7.0236, "name": "Titik 2 (Selat Sunda Selatan)"},
    {"id": "titik_3", "lon": 104.9594, "lat": -6.6195, "name": "Titik 3 (Ujung Kulon)"},
    {"id": "titik_4", "lon": 105.6083, "lat": -6.5007, "name": "Titik 4 (Labuan / Barat)"},
    {"id": "titik_5", "lon": 105.6736, "lat": -5.9519, "name": "Titik 5 (Selat Sunda Utara)"},
    {"id": "titik_6", "lon": 106.6378, "lat": -5.7564, "name": "Titik 6 (Teluk Banten / Karangantu)"},
]

# Dataset Copernicus
DATASETS = {
    "chl": {
        "id": "cmems_mod_glo_bgc-pft_anfc_0.25deg_P1D-m",
        "variables": ["chl"],
        "extract_var": "chl"
    },
    "sst": {
        "id": "cmems_mod_glo_phy-thetao_anfc_0.083deg_P1D-m",
        "variables": ["thetao"],
        "extract_var": "thetao"
    },
    "swv": {
        "id": "cmems_mod_glo_phy-cur_anfc_0.083deg_P1D-m",
        "variables": ["uo", "vo"],
        "extract_var": ["uo", "vo"]
    }
}

# Batas Geografis Banten (Bounding Box ekstraksi)
BBOX = {
    "min_lon": 104.5,
    "max_lon": 107.0,
    "min_lat": -7.5,
    "max_lat": -5.5
}

DEFAULT_START_DATE = os.getenv("COPERNICUS_START_DATE", "2026-10-29")
CSV_BACKUP_PATH = ROOT_DIR / "data" / "ingest_backup" / "copernicus_ocean.csv"
API_URL = os.getenv("APP_URL", "http://localhost:3000")
API_KEY = os.getenv("INGEST_API_KEY", "")


def get_latest_recorded_date(csv_path: Path, default_start: str) -> str:
    """Cek tanggal terakhir yang sudah tercatat di file CSV cadangan lokal."""
    if not csv_path.exists():
        return default_start
    try:
        df = pd.read_csv(csv_path)
        if "date" in df.columns and len(df) > 0:
            latest = str(df["date"].max()).strip()
            # Tanggal berikutnya setelah yang sudah tercatat
            dt = datetime.date.fromisoformat(latest) + datetime.timedelta(days=1)
            return dt.isoformat()
    except Exception as e:
        logger.warning(f"Gagal membaca tanggal dari {csv_path}: {e}")
    return default_start


def fetch_dataset_for_date_range(dataset_key: str, start_dt: str, end_dt: str, username: str, password: str):
    """Mengambil xarray Dataset dari Copernicus Marine Service menggunakan library copernicusmarine."""
    import copernicusmarine
    cfg = DATASETS[dataset_key]
    logger.info(f"Mengunduh subset {dataset_key.upper()} ({cfg['id']}) untuk periode {start_dt} s.d. {end_dt}...")

    # Coba gunakan open_dataset (in-memory streaming)
    try:
        ds = copernicusmarine.open_dataset(
            dataset_id=cfg["id"],
            username=username,
            password=password,
            variables=cfg["variables"],
            minimum_longitude=BBOX["min_lon"],
            maximum_longitude=BBOX["max_lon"],
            minimum_latitude=BBOX["min_lat"],
            maximum_latitude=BBOX["max_lat"],
            start_datetime=f"{start_dt}T00:00:00",
            end_datetime=f"{end_dt}T23:59:59"
        )
        return ds
    except Exception as err:
        logger.warning(f"open_dataset streaming gagal ({err}), beralih ke subset file...")

    # Fallback ke copernicusmarine.subset (unduh file netcdf temporer)
    tmp_dir = ROOT_DIR / "data" / "ingest_backup" / "tmp_cmems"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{dataset_key}_{start_dt}_{end_dt}.nc"

    res = copernicusmarine.subset(
        dataset_id=cfg["id"],
        username=username,
        password=password,
        variables=cfg["variables"],
        minimum_longitude=BBOX["min_lon"],
        maximum_longitude=BBOX["max_lon"],
        minimum_latitude=BBOX["min_lat"],
        maximum_latitude=BBOX["max_lat"],
        start_datetime=f"{start_dt}T00:00:00",
        end_datetime=f"{end_dt}T23:59:59",
        output_directory=str(tmp_dir),
        output_filename=filename,
        overwrite=True
    )

    import xarray as xr
    out_file = tmp_dir / filename
    if out_file.exists():
        ds = xr.open_dataset(out_file)
        return ds
    raise RuntimeError(f"Gagal mengunduh file subset {dataset_key} ke {out_file}")


def extract_points_from_datasets(ds_chl, ds_sst, ds_swv, target_dates: list[str]) -> list[dict]:
    """Ekstraksi nilai parameter pada 6 titik koordinat stasiun untuk setiap tanggal."""
    records = []

    def get_coord_names(ds):
        lon_name = "longitude" if "longitude" in ds.coords else "lon"
        lat_name = "latitude" if "latitude" in ds.coords else "lat"
        time_name = "time" if "time" in ds.coords else "date"
        return lon_name, lat_name, time_name

    chl_lon, chl_lat, chl_time = get_coord_names(ds_chl) if ds_chl is not None else (None, None, None)
    sst_lon, sst_lat, sst_time = get_coord_names(ds_sst) if ds_sst is not None else (None, None, None)
    swv_lon, swv_lat, swv_time = get_coord_names(ds_swv) if ds_swv is not None else (None, None, None)

    for dt_str in target_dates:
        logger.info(f"Mengekstrak 6 titik stasiun untuk tanggal {dt_str}...")
        for st in STATIONS:
            lon, lat = st["lon"], st["lat"]
            st_id = st["id"]

            row = {
                "station_id": st_id,
                "date": dt_str,
                "chl": None,
                "sst": None,
                "uo": None,
                "vo": None
            }

            # Ekstrak Chl-a
            if ds_chl is not None and "chl" in ds_chl:
                try:
                    pt_chl = ds_chl["chl"].sel({chl_lon: lon, chl_lat: lat}, method="nearest")
                    if "depth" in pt_chl.dims:
                        pt_chl = pt_chl.isel(depth=0)
                    if chl_time in pt_chl.dims:
                        pt_chl = pt_chl.sel({chl_time: dt_str}, method="nearest")
                    val = pt_chl.values
                    if hasattr(val, "ndim") and val.ndim > 0:
                        val = val.flat[0]
                    val = float(val)
                    if not math.isnan(val) and 0 <= val <= 50:
                        row["chl"] = round(val, 4)
                except Exception as e:
                    logger.debug(f"Chl extraction error at {st_id}: {e}")

            # Ekstrak SST (thetao)
            if ds_sst is not None and "thetao" in ds_sst:
                try:
                    pt_sst = ds_sst["thetao"].sel({sst_lon: lon, sst_lat: lat}, method="nearest")
                    if "depth" in pt_sst.dims:
                        pt_sst = pt_sst.isel(depth=0)
                    if sst_time in pt_sst.dims:
                        pt_sst = pt_sst.sel({sst_time: dt_str}, method="nearest")
                    val = float(pt_sst.values.squeeze())
                    if not math.isnan(val) and 15 <= val <= 35:
                        row["sst"] = round(val, 2)
                except Exception as e:
                    logger.debug(f"SST extraction error at {st_id}: {e}")

            # Ekstrak Arus (uo & vo)
            if ds_swv is not None:
                try:
                    pt_uo = ds_swv["uo"].sel({swv_lon: lon, swv_lat: lat}, method="nearest")
                    pt_vo = ds_swv["vo"].sel({swv_lon: lon, swv_lat: lat}, method="nearest")
                    if "depth" in pt_uo.dims:
                        pt_uo = pt_uo.isel(depth=0)
                        pt_vo = pt_vo.isel(depth=0)
                    if swv_time in pt_uo.dims:
                        pt_uo = pt_uo.sel({swv_time: dt_str}, method="nearest")
                        pt_vo = pt_vo.sel({swv_time: dt_str}, method="nearest")
                    val_u = float(pt_uo.values.squeeze())
                    val_v = float(pt_vo.values.squeeze())
                    if not math.isnan(val_u) and -5 <= val_u <= 5:
                        row["uo"] = round(val_u, 4)
                    if not math.isnan(val_v) and -5 <= val_v <= 5:
                        row["vo"] = round(val_v, 4)
                except Exception as e:
                    logger.debug(f"Current extraction error at {st_id}: {e}")

            records.append(row)

    return records


def save_to_csv(records: list[dict], out_path: Path):
    """Menyimpan data observasi baru ke file CSV cadangan lokal."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    new_df = pd.DataFrame(records)
    if out_path.exists():
        existing_df = pd.read_csv(out_path)
        combined = pd.concat([existing_df, new_df], ignore_index=True)
        # Hapus duplikasi berdasarkan station_id dan date (pertahankan yang terbaru)
        combined = combined.drop_duplicates(subset=["station_id", "date"], keep="last")
        combined.sort_values(by=["date", "station_id"], inplace=True)
        combined.to_csv(out_path, index=False)
    else:
        new_df.sort_values(by=["date", "station_id"], inplace=True)
        new_df.to_csv(out_path, index=False)
    logger.info(f"Berhasil menyimpan {len(records)} baris data ke {out_path}")


def ingest_to_api(records: list[dict], app_url: str, api_key: str):
    """Mengirim baris observasi oseanografi ke database web melalui endpoint /api/ingest/ocean."""
    if not api_key:
        logger.warning("INGEST_API_KEY tidak ditentukan. Pengiriman ke API backend dilewati.")
        return False

    url = f"{app_url.rstrip('/')}/api/ingest/ocean"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    # API membatasi maksimal 500 baris per batch
    batch_size = 500
    total_success = 0

    for i in range(0, len(records), batch_size):
        chunk = records[i:i + batch_size]
        payload = {"rows": chunk}
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=30)
            if resp.status_code in [200, 201]:
                res_json = resp.json()
                logger.info(f"Ingest batch {i // batch_size + 1} sukses: {res_json.get('message', 'OK')} (inserted: {res_json.get('inserted')}, updated: {res_json.get('updated')})")
                total_success += len(chunk)
            else:
                logger.error(f"Ingest gagal [HTTP {resp.status_code}]: {resp.text}")
        except Exception as e:
            logger.error(f"Gagal menghubungi endpoint API Ingest ({url}): {e}")

    return total_success == len(records)


def run_pipeline(start_date: str, end_date: str, dry_run: bool = False):
    """Menjalankan siklus unduh, ekstraksi titik, simpan CSV, dan kirim ke API."""
    user = os.getenv("COPERNICUS_USERNAME")
    pw = os.getenv("COPERNICUS_PASSWORD")

    if not user or not pw:
        logger.error("Kredensial COPERNICUS_USERNAME dan COPERNICUS_PASSWORD wajib ada di environment / .env")
        return False

    dt_start = datetime.date.fromisoformat(start_date)
    dt_end = datetime.date.fromisoformat(end_date)

    if dt_start > dt_end:
        logger.info(f"Data sudah up-to-date. Tanggal mulai ({start_date}) > tanggal akhir ({end_date}). Tidak ada data baru untuk diunduh.")
        return True

    # Susun daftar tanggal yang akan diunduh
    target_dates = []
    curr = dt_start
    while curr <= dt_end:
        target_dates.append(curr.isoformat())
        curr += datetime.timedelta(days=1)

    logger.info(f"Memulai pipeline pengunduhan Copernicus dari {start_date} s.d. {end_date} ({len(target_dates)} hari, {len(target_dates) * 6} observasi)...")

    # Unduh dataset 3 variabel dari Copernicus
    ds_chl = None
    ds_sst = None
    ds_swv = None

    try:
        ds_chl = fetch_dataset_for_date_range("chl", start_date, end_date, user, pw)
    except Exception as e:
        logger.error(f"Gagal mengunduh Chl-a: {e}")

    try:
        ds_sst = fetch_dataset_for_date_range("sst", start_date, end_date, user, pw)
    except Exception as e:
        logger.error(f"Gagal mengunduh SST: {e}")

    try:
        ds_swv = fetch_dataset_for_date_range("swv", start_date, end_date, user, pw)
    except Exception as e:
        logger.error(f"Gagal mengunduh Arus (SWV): {e}")

    if ds_chl is None and ds_sst is None and ds_swv is None:
        logger.error("Tidak ada dataset Copernicus yang berhasil diunduh. Siklus dibatalkan.")
        return False

    # Ekstrak data pada 6 titik koordinat
    records = extract_points_from_datasets(ds_chl, ds_sst, ds_swv, target_dates)
    logger.info(f"Berhasil mengekstrak {len(records)} baris data observasi.")

    if dry_run:
        logger.info("Mode --dry-run aktif. Data tidak disimpan atau dikirim ke API.")
        logger.info(f"Contoh 2 baris pertama:\n{records[:2]}")
        return True

    # 1. Simpan cadangan offline lokal
    save_to_csv(records, CSV_BACKUP_PATH)

    # 2. Ingest otomatis ke backend Terrasea-Stock
    if API_KEY:
        ingest_to_api(records, API_URL, API_KEY)
    else:
        logger.warning("INGEST_API_KEY tidak disetel. Jalankan `npm run create-api-key` atau set di .env untuk mengaktifkan ingest otomatis.")

    return True


def main():
    parser = argparse.ArgumentParser(description="Bot Pengunduh Data Oseanografi Copernicus untuk WebGIS Terrasea-Stock")
    parser.add_argument("--mode", choices=["once", "daemon"], default="once", help="Mode eksekusi: 'once' (sekali jalan) atau 'daemon' (looping berkala)")
    parser.add_argument("--interval", type=int, default=6, help="Interval loop dalam jam untuk mode daemon (default: 6 jam)")
    parser.add_argument("--start-date", type=str, default=None, help="Tanggal awal custom (format: YYYY-MM-DD)")
    parser.add_argument("--end-date", type=str, default=None, help="Tanggal akhir custom (format: YYYY-MM-DD)")
    parser.add_argument("--dry-run", action="store_true", help="Uji coba ekstraksi tanpa menyimpan ke CSV atau kirim ke database")

    args = parser.parse_args()

    # Tentukan tanggal awal
    if args.start_date:
        start_date = args.start_date
    else:
        start_date = get_latest_recorded_date(CSV_BACKUP_PATH, DEFAULT_START_DATE)

    # Tentukan tanggal akhir (default: hari ini)
    if args.end_date:
        end_date = args.end_date
    else:
        end_date = datetime.date.today().isoformat()

    logger.info(f"=== BOT COPERNICUS DIMULAI (Mode: {args.mode.upper()}) ===")
    logger.info(f"Tanggal Mulai : {start_date}")
    logger.info(f"Tanggal Akhir : {end_date}")

    if args.mode == "once":
        success = run_pipeline(start_date, end_date, dry_run=args.dry_run)
        sys.exit(0 if success else 1)

    elif args.mode == "daemon":
        logger.info(f"Mode daemon aktif. Bot akan memeriksa data baru setiap {args.interval} jam.")
        while True:
            # Refresh tanggal awal & akhir
            st_date = get_latest_recorded_date(CSV_BACKUP_PATH, DEFAULT_START_DATE)
            en_date = datetime.date.today().isoformat()
            try:
                run_pipeline(st_date, en_date, dry_run=args.dry_run)
            except Exception as e:
                logger.error(f"Kesalahan pada siklus daemon: {e}")

            logger.info(f"Tidur selama {args.interval} jam sebelum pemeriksaan berikutnya...")
            time.sleep(args.interval * 3600)


if __name__ == "__main__":
    main()

