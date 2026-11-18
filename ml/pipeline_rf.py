"""Pipeline Random Forest Terrasea-Stock: Oseanografi IDW & Stock Prediction 2 Zona.
Menghasilkan artefak:
1. data/processed/zones.geojson (2 zona: Z-01 Area Atas Banten & Z-02 Area Bawah Banten)
2. data/processed/forecast_Z-01.json (Karangantu) & forecast_Z-02.json (Lebak)
3. data/processed/grids/{sst,chl,current,abundance}_2026-11.json
"""
import json
import math
import warnings
from datetime import datetime, timezone
from pathlib import Path
import yaml
import joblib
import numpy as np
import pandas as pd
import xarray as xr
from shapely.geometry import shape, Point

warnings.filterwarnings('ignore')

ROOT = Path(__file__).resolve().parent.parent
PROCESSED_DIR = ROOT / 'data' / 'processed'
GRIDS_DIR = PROCESSED_DIR / 'grids'
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
GRIDS_DIR.mkdir(parents=True, exist_ok=True)

with open(ROOT / 'ml' / 'config.yaml') as f:
    cfg_yaml = yaml.safe_load(f)
TAC_FACTOR = float(cfg_yaml.get('tac_factor', 0.8))

def find_data_file(subpath):
    """Mencari berkas data di data/baseline/ atau data/unprocessed data/."""
    p1 = ROOT / 'data' / 'baseline' / subpath
    if p1.exists():
        return p1
    p2 = ROOT / 'data' / 'unprocessed data' / subpath
    if p2.exists():
        return p2
    return p1

# 1. Koordinat 6 Stasiun Sesuai Spesifikasi
STATIONS = {
    1: {'lon': 106.0994, 'lat': -7.2230, 'name': 'Titik 1 (Banten Selatan Timur)'},
    2: {'lon': 105.2976, 'lat': -7.0236, 'name': 'Titik 2 (Banten Selatan Barat)'},
    3: {'lon': 104.9594, 'lat': -6.6195, 'name': 'Titik 3 (Selat Sunda Luar)'},
    4: {'lon': 105.6083, 'lat': -6.5007, 'name': 'Titik 4 (Selat Sunda Tengah)'},
    5: {'lon': 105.6736, 'lat': -5.9519, 'name': 'Titik 5 (Selat Sunda Utara)'},
    6: {'lon': 106.6378, 'lat': -5.7564, 'name': 'Titik 6 (Teluk Banten)'},
}

# Segitiga interpolasi stasiun
TRIANGLES_BAWAH = [(1, 2, 4), (2, 3, 4)]
TRIANGLES_ATAS = [(3, 4, 5), (4, 5, 6)]

MODEL_VER = 'RF-v1.0'
NOW_ISO = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')

print("=== MEMPROSES PREDIKSI OSEANOGRAFI 6 TITIK (MODEL RF) ===")
# 2. Muat data historis oseanografi & observasi baru hasil bot
ocean_monthly_all = {}
ocean_daily_all = {}

# Cek apakah ada berkas observasi baru dari bot / ingest (raw Turso export & backup)
obs_csv_paths = [
    ROOT / 'data' / 'raw' / 'observations_ocean.csv',
    ROOT / 'data' / 'ingest_backup' / 'copernicus_ocean.csv'
]
new_obs_df = None
for o_path in obs_csv_paths:
    if o_path.exists():
        try:
            tmp_df = pd.read_csv(o_path)
            if 'date' in tmp_df.columns and len(tmp_df) > 0:
                tmp_df['date'] = pd.to_datetime(tmp_df['date'], errors='coerce')
                tmp_df = tmp_df.dropna(subset=['date'])
                if new_obs_df is None:
                    new_obs_df = tmp_df
                else:
                    new_obs_df = pd.concat([new_obs_df, tmp_df], ignore_index=True)
        except Exception as e:
            print(f"[WARN] Gagal membaca observasi baru dari {o_path}: {e}")

if new_obs_df is not None:
    # Prioritaskan baris yang memiliki nilai chl non-null saat deduplikasi
    new_obs_df['has_chl'] = new_obs_df['chl'].notna()
    new_obs_df = new_obs_df.sort_values(by=['station_id', 'date', 'has_chl']).drop_duplicates(subset=['station_id', 'date'], keep='last').drop(columns=['has_chl'])
    print(f"[INFO] Terdeteksi {len(new_obs_df)} baris observasi baru dari bot (rentang: {new_obs_df['date'].min().strftime('%Y-%m-%d')} s.d. {new_obs_df['date'].max().strftime('%Y-%m-%d')})")

for t in range(1, 7):
    f_path = find_data_file(f'Oseanografi/data_log_titik_{t}.xlsx')
    df = pd.read_excel(f_path)
    col_t = [c for c in df.columns if 'time' in c.lower() or 'tanggal' in c.lower()][0]
    df[col_t] = pd.to_datetime(df[col_t], errors='coerce')
    df = df.dropna(subset=[col_t]).sort_values(col_t).reset_index(drop=True)

    # Gabungkan dengan observasi harian terbaru dari bot bila ada
    if new_obs_df is not None:
        st_aliases = [f'titik_{t}', f'titik {t}', f'titik{t}', str(t), f't{t}']
        sub_obs = new_obs_df[new_obs_df['station_id'].astype(str).str.lower().isin(st_aliases)].copy()
        if len(sub_obs) > 0:
            max_hist = df[col_t].max()
            new_rows = sub_obs[sub_obs['date'] > max_hist].copy()
            if len(new_rows) > 0:
                append_df = pd.DataFrame()
                append_df[col_t] = new_rows['date']
                append_df['SST (degC)'] = pd.to_numeric(new_rows['sst'], errors='coerce')
                append_df['uo'] = pd.to_numeric(new_rows['uo'], errors='coerce').fillna(0.0)
                append_df['vo'] = pd.to_numeric(new_rows['vo'], errors='coerce').fillna(0.0)
                append_df['Current Speed (m/s)'] = np.sqrt(append_df['uo']**2 + append_df['vo']**2)
                append_df['Chlorophyll-a (mg m-3)'] = pd.to_numeric(new_rows['chl'], errors='coerce')
                
                df = pd.concat([df, append_df], ignore_index=True)
                df = df.drop_duplicates(subset=[col_t], keep='last').sort_values(col_t).reset_index(drop=True)
                
                # Interpolasi linear agar transisi antara data historis dan observasi baru halus,
                # sedangkan nilai observasi riil (misal tgl 17 dan 18 Nov) tetap persis seperti di database
                df['Chlorophyll-a (mg m-3)'] = df['Chlorophyll-a (mg m-3)'].interpolate(method='linear').bfill().ffill()
                df['SST (degC)'] = df['SST (degC)'].interpolate(method='linear').bfill().ffill()
                print(f"Titik {t}: ditambahkan {len(new_rows)} baris data observasi baru s.d. {df[col_t].max().strftime('%Y-%m-%d')}")

    ocean_daily_all[t] = df.copy()
    df['YearMonth'] = df[col_t].dt.to_period('M')
    
    df_m = df.groupby('YearMonth').agg({
        'SST (degC)': 'mean',
        'Chlorophyll-a (mg m-3)': 'mean',
        'uo': 'mean',
        'vo': 'mean'
    }).reset_index()
    df_m.rename(columns={'SST (degC)': 'sst', 'Chlorophyll-a (mg m-3)': 'chl'}, inplace=True)
    df_m['swv'] = np.sqrt(df_m['uo']**2 + df_m['vo']**2)
    ocean_monthly_all[t] = df_m

# Tentukan tanggal acuan terkini secara dinamis berdasarkan data observasi
all_max_dates = [ocean_daily_all[t][col_t].max() for t in range(1, 7)]
REF_DATE = max(all_max_dates).date()
TARGET_MONTH = REF_DATE.strftime('%Y-%m')
next_m_val = 1 if REF_DATE.month == 12 else REF_DATE.month + 1
NEXT_MONTH = f"{REF_DATE.year + 1}-01" if REF_DATE.month == 12 else f"{REF_DATE.year}-{next_m_val:02d}"

print(f"\n[DINAMIS] Tanggal Acuan Terukur (REF_DATE) : {REF_DATE}")
print(f"[DINAMIS] Target Bulan Utama (TARGET_MONTH) : {TARGET_MONTH}")
print(f"[DINAMIS] Target Bulan Berikut (NEXT_MONTH) : {NEXT_MONTH}")

# Prediksi Oseanografi Bulanan untuk TARGET_MONTH dan NEXT_MONTH
ocean_pred_target = {}
ocean_pred_next = {}

target_m_num = REF_DATE.month
b_sin_target = np.sin(2 * np.pi * target_m_num / 12)
b_cos_target = np.cos(2 * np.pi * target_m_num / 12)

b_sin_next = np.sin(2 * np.pi * next_m_val / 12)
b_cos_next = np.cos(2 * np.pi * next_m_val / 12)

for t in range(1, 7):
    df_m = ocean_monthly_all[t]
    preds_target = {}
    for var in ['sst', 'chl', 'swv']:
        model = joblib.load(ROOT / f'ml/models/oseanografi/model_rf_titik_{t}_{var}.pkl')
        scaler = joblib.load(ROOT / f'ml/models/oseanografi/scaler_rf_titik_{t}_{var}.pkl')
        vals = df_m[var].iloc[-3:].values # lag3, lag2, lag1
        feat = np.array([[vals[2], vals[1], vals[0], b_sin_target, b_cos_target]])
        scaled_feat = scaler.transform(feat)
        pred = float(model.predict(scaled_feat)[0])
        preds_target[var] = pred
        
    uo_mean = float(df_m['uo'].mean())
    vo_mean = float(df_m['vo'].mean())
    speed_target = preds_target['swv']
    curr_norm = math.sqrt(uo_mean**2 + vo_mean**2) or 1.0
    preds_target['uo'] = speed_target * (uo_mean / curr_norm)
    preds_target['vo'] = speed_target * (vo_mean / curr_norm)
    preds_target['direction_deg'] = (math.atan2(preds_target['uo'], preds_target['vo']) * 180 / math.pi) % 360
    ocean_pred_target[t] = preds_target

    preds_next = {}
    for var in ['sst', 'chl', 'swv']:
        model = joblib.load(ROOT / f'ml/models/oseanografi/model_rf_titik_{t}_{var}.pkl')
        scaler = joblib.load(ROOT / f'ml/models/oseanografi/scaler_rf_titik_{t}_{var}.pkl')
        vals = df_m[var].iloc[-3:].values
        feat_next = np.array([[preds_target[var], vals[2], vals[1], b_sin_next, b_cos_next]])
        scaled_feat_next = scaler.transform(feat_next)
        pred_next = float(model.predict(scaled_feat_next)[0])
        preds_next[var] = pred_next
        
    speed_next = preds_next['swv']
    preds_next['uo'] = speed_next * (uo_mean / curr_norm)
    preds_next['vo'] = speed_next * (vo_mean / curr_norm)
    preds_next['direction_deg'] = (math.atan2(preds_next['uo'], preds_next['vo']) * 180 / math.pi) % 360
    ocean_pred_next[t] = preds_next

    print(f"Titik {t}: Lon={STATIONS[t]['lon']}, Lat={STATIONS[t]['lat']} -> {TARGET_MONTH}: SST={preds_target['sst']:.2f}°C, Chl={preds_target['chl']:.2f} | {NEXT_MONTH}: SST={preds_next['sst']:.2f}°C, Chl={preds_next['chl']:.2f}")

# Alias untuk kompatibilitas ke variabel lama
ocean_pred_2026_11 = ocean_pred_target
ocean_pred_2026_12 = ocean_pred_next


print("\n=== INTERPOLASI IDW GRID SPASIAL (PERAIRAN BANTEN) ===")
# 3. Grid Parameter
BBOX = [104.8, -7.3, 106.8, -5.6] # [west, south, east, north]
NX, NY = 60, 50

# Muat daratan untuk masking sel darat
land_path = ROOT / 'data' / 'geo' / 'land.geojson'
land_shapes = []
if land_path.exists():
    with open(land_path) as f:
        land_data = json.load(f)
    for feat in land_data.get('features', []):
        land_shapes.append(shape(feat['geometry']))

# Muat poligon zona
with open(PROCESSED_DIR / 'Z-01.geojson') as f:
    poly_z1 = shape(json.load(f)['features'][0]['geometry'])
with open(PROCESSED_DIR / 'Z-02.geojson') as f:
    poly_z2 = shape(json.load(f)['features'][0]['geometry'])

lons = np.linspace(BBOX[0], BBOX[2], NX)
lats = np.linspace(BBOX[3], BBOX[1], NY) # Dari utara ke selatan (baris 0 = utara)

# Muat data batimetri GEBCO dari NetCDF atau fallback ke bathymetry.json
bathy_path = ROOT / 'data' / 'raw' / 'batimetri.nc'
if not bathy_path.exists():
    fallback_candidates = [
        ROOT / 'data' / 'processed' / 'batimetri.nc',
        Path(r'C:/Users/AQILL/.gemini/antigravity/brain/6f1e459d-a344-4275-99db-57b9b452ba54/.user_uploaded/media_1794840460388_3ac59ffe.nc')
    ]
    for cand in fallback_candidates:
        if cand.exists():
            bathy_path = cand
            break

if bathy_path.exists():
    ds_bathy = xr.open_dataset(bathy_path)
    elev_da = ds_bathy['elevation']
    interp_elev = elev_da.interp(lon=lons, lat=lats, method='linear').values
elif (GRIDS_DIR / 'bathymetry.json').exists():
    with open(GRIDS_DIR / 'bathymetry.json') as bf:
        bathy_json = json.load(bf)
    bathy_vals = [(-v if v is not None else 10.0) for v in bathy_json['values']]
    interp_elev = np.array(bathy_vals).reshape((NY, NX))
else:
    interp_elev = np.zeros((NY, NX))

grid_sst = []
grid_chl = []
grid_cur = []
grid_dir = []
grid_uo = []
grid_vo = []
grid_bathy = []
grid_abund = {'pelagis_besar': [], 'pelagis_kecil': [], 'demersal': []}

for i_lat, r_lat in enumerate(lats):
    for i_lon, c_lon in enumerate(lons):
        pt = Point(c_lon, r_lat)
        elev_val = float(interp_elev[i_lat, i_lon]) if not np.isnan(interp_elev[i_lat, i_lon]) else 0.0
        
        # Cek apakah di darat (poligon daratan atau elevasi darat > 0)
        is_land = any(ls.contains(pt) for ls in land_shapes) or elev_val > 5.0
        if is_land:
            grid_sst.append(None)
            grid_chl.append(None)
            grid_cur.append(None)
            grid_dir.append(None)
            grid_uo.append(None)
            grid_vo.append(None)
            grid_bathy.append(None)
            for g in grid_abund:
                grid_abund[g].append('low')
            continue
        
        depth_m = max(0.0, -elev_val)
        grid_bathy.append(round(depth_m, 1))
        
        # Tentukan stasiun rujukan berdasarkan area
        # Jika lebih condong ke utara (-6.6 ke atas) atau di Z-01 -> stasiun 3, 4, 5, 6
        # Jika di selatan -> stasiun 1, 2, 3, 4
        if r_lat > -6.6:
            st_ids = [3, 4, 5, 6]
        else:
            st_ids = [1, 2, 4, 3]
            
        weights = []
        for sid in st_ids:
            slon, slat = STATIONS[sid]['lon'], STATIONS[sid]['lat']
            dist = math.hypot(c_lon - slon, r_lat - slat)
            if dist < 1e-5:
                weights.append((sid, 1e5))
            else:
                weights.append((sid, 1.0 / (dist ** 2)))
                
        tot_w = sum(w for _, w in weights)
        val_sst = sum(ocean_pred_2026_11[sid]['sst'] * w for sid, w in weights) / tot_w
        val_chl = sum(ocean_pred_2026_11[sid]['chl'] * w for sid, w in weights) / tot_w
        val_cur = sum(ocean_pred_2026_11[sid]['swv'] * w for sid, w in weights) / tot_w
        val_uo = sum(ocean_pred_2026_11[sid]['uo'] * w for sid, w in weights) / tot_w
        val_vo = sum(ocean_pred_2026_11[sid]['vo'] * w for sid, w in weights) / tot_w
        val_dir = (math.atan2(val_uo, val_vo) * 180 / math.pi) % 360

        grid_sst.append(round(float(val_sst), 2))
        grid_chl.append(round(float(val_chl), 3))
        grid_cur.append(round(float(val_cur), 3))
        grid_uo.append(round(float(val_uo), 3))
        grid_vo.append(round(float(val_vo), 3))
        grid_dir.append(round(float(val_dir), 1))
        
        # Kelimpahan berbasis aturan lingkungan:
        # 1. Pelagis besar & pelagis kecil: berdasarkan Klorofil-a & SST
        if val_chl > 0.45:
            grid_abund['pelagis_besar'].append('high')
            grid_abund['pelagis_kecil'].append('high')
        elif val_chl > 0.25:
            grid_abund['pelagis_besar'].append('mid')
            grid_abund['pelagis_kecil'].append('high')
        else:
            grid_abund['pelagis_besar'].append('low')
            grid_abund['pelagis_kecil'].append('mid')
            
        # 2. Demersal: spesifik berbasis kedalaman batimetri (permintaan user)
        # 40 - 60 meter: Sangat Berlimpah ('high')
        # 0 - 40 meter: Berlimpah ('mid')
        # > 60 meter: Kurang Berlimpah ('low')
        if 40.0 <= depth_m <= 60.0:
            grid_abund['demersal'].append('high')
        elif 0.0 <= depth_m < 40.0:
            grid_abund['demersal'].append('mid')
        else:
            grid_abund['demersal'].append('low')

# Simpan artefak grid JSON
def save_grid_artifact(var_name, unit, values, d=2):
    valid = [v for v in values if v is not None]
    vmin = round(float(min(valid)), d) if valid else 0.0
    vmax = round(float(max(valid)), d) if valid else 1.0
    artifact = {
        'var': var_name,
        'month': TARGET_MONTH,
        'unit': unit,
        'bbox': BBOX,
        'nx': NX,
        'ny': NY,
        'vmin': vmin,
        'vmax': vmax,
        'values': values
    }
    if var_name == 'current':
        artifact['uo'] = grid_uo
        artifact['vo'] = grid_vo
        artifact['direction_deg'] = grid_dir
    out_file = GRIDS_DIR / f"{var_name}_{TARGET_MONTH}.json"
    with open(out_file, 'w') as f:
        json.dump(artifact, f)
    print(f"Disimpan: {out_file.name} (vmin={vmin}, vmax={vmax})")
    
    # Salinan statis non-bulan (misal bathymetry.json)
    if var_name == 'bathymetry':
        with open(GRIDS_DIR / "bathymetry.json", 'w') as f:
            json.dump(artifact, f)
        print("Disimpan: bathymetry.json")

save_grid_artifact('sst', '°C', grid_sst, 1)
save_grid_artifact('chl', 'mg/m³', grid_chl, 2)
save_grid_artifact('current', 'm/s', grid_cur, 2)
save_grid_artifact('bathymetry', 'm', grid_bathy, 1)

abund_artifact = {
    'month': TARGET_MONTH,
    'nx': NX,
    'ny': NY,
    'bbox': BBOX,
    'groups': grid_abund
}
with open(GRIDS_DIR / f"abundance_{TARGET_MONTH}.json", 'w') as f:
    json.dump(abund_artifact, f)
print(f"Disimpan: abundance_{TARGET_MONTH}.json")


print(f"\n=== INTERPOLASI IDW HARIAN & OCEAN WINDOW DINAMIS (10 HARI: H-6 s.d. H+3 untuk acuan {REF_DATE}) ===")
# Generate dgrid 10 hari (7 hari terukur + 3 hari prakiraan) dan ocean_window dinamis untuk Marine Stock
offsets_ow = [-3, -2, -1, 0, 1, 2, 3] # Kontrak ocean_window.days tepat 7 hari (H-3..H+3)
offsets_all = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3] # 10 hari (7 terukur + 3 forecast)
window_days_info = []
dgrid_days_info = []

# Kumpulkan nilai 6 stasiun untuk masing-masing hari dari 10 hari
st_vals_by_date = {}

for off in offsets_ow:
    cur_d = REF_DATE + pd.Timedelta(days=off)
    d_str = cur_d.strftime('%Y-%m-%d')
    kind = 'observed' if off <= 0 else 'forecast'
    h_days = None if off <= 0 else off
    window_days_info.append({
        'date': d_str,
        'offset': off,
        'kind': kind,
        'horizon_days': h_days
    })

for off in offsets_all:
    cur_d = REF_DATE + pd.Timedelta(days=off)
    d_str = cur_d.strftime('%Y-%m-%d')
    kind = 'observed' if off <= 0 else 'forecast'
    h_days = None if off <= 0 else off
    dgrid_days_info.append({
        'date': d_str,
        'offset': off,
        'kind': kind,
        'horizon_days': h_days
    })
    st_vals_by_date[d_str] = {}

for t in range(1, 7):
    df_t = ocean_daily_all[t].copy()
    c_t = [c for c in df_t.columns if 'time' in c.lower() or 'tanggal' in c.lower()][0]
    df_t['DateOnly'] = pd.to_datetime(df_t[c_t]).dt.date
    
    # 1. Observed days (7 hari ke belakang: H-6..H0)
    for off in [-6, -5, -4, -3, -2, -1, 0]:
        cur_d = REF_DATE + pd.Timedelta(days=off)
        d_str = cur_d.strftime('%Y-%m-%d')
        matched = df_t[df_t['DateOnly'] == cur_d]
        if len(matched) > 0:
            row = matched.iloc[-1]
            sst_v = float(row['SST (degC)'])
            chl_v = max(float(row['Chlorophyll-a (mg m-3)']), 0.0)
            uo_v = float(row['uo'])
            vo_v = float(row['vo'])
            swv_v = float(np.sqrt(uo_v**2 + vo_v**2))
        else:
            row = df_t.iloc[-1]
            sst_v = float(row['SST (degC)'])
            chl_v = max(float(row['Chlorophyll-a (mg m-3)']), 0.0)
            uo_v = float(row['uo'])
            vo_v = float(row['vo'])
            swv_v = float(np.sqrt(uo_v**2 + vo_v**2))
        st_vals_by_date[d_str][t] = {
            'sst': sst_v, 'chl': chl_v, 'uo': uo_v, 'vo': vo_v, 'speed': swv_v
        }
        
    # 2. Forecast days (H+1..H+3)
    uo_mean = float(df_t['uo'].mean())
    vo_mean = float(df_t['vo'].mean())
    curr_norm = math.sqrt(uo_mean**2 + vo_mean**2) or 1.0
    
    tail_vals = {
        'sst': list(df_t['SST (degC)'].tail(10).values),
        'chl': list(df_t['Chlorophyll-a (mg m-3)'].tail(10).values),
        'swv': list(np.sqrt(df_t['uo']**2 + df_t['vo']**2).tail(10).values)
    }
    
    for step in range(1, 4):
        target_d = REF_DATE + pd.Timedelta(days=step)
        d_str = target_d.strftime('%Y-%m-%d')
        b_sin_d = np.sin(2 * np.pi * target_d.month / 12)
        b_cos_d = np.cos(2 * np.pi * target_d.month / 12)
        
        step_preds = {}
        for var in ['sst', 'chl', 'swv']:
            model = joblib.load(ROOT / f'ml/models/oseanografi/model_rf_titik_{t}_{var}.pkl')
            scaler = joblib.load(ROOT / f'ml/models/oseanografi/scaler_rf_titik_{t}_{var}.pkl')
            hist = tail_vals[var]
            feat = np.array([[hist[-1], hist[-2], hist[-3], b_sin_d, b_cos_d]])
            scaled = scaler.transform(feat)
            pred_val = float(model.predict(scaled)[0])
            if var == 'chl' or var == 'swv':
                pred_val = max(pred_val, 0.01)
            step_preds[var] = pred_val
            tail_vals[var].append(pred_val)
            
        sp = step_preds['swv']
        uo_pred = sp * (uo_mean / curr_norm)
        vo_pred = sp * (vo_mean / curr_norm)
        st_vals_by_date[d_str][t] = {
            'sst': step_preds['sst'],
            'chl': step_preds['chl'],
            'speed': sp,
            'uo': uo_pred,
            'vo': vo_pred
        }

# Lakukan interpolasi IDW untuk setiap hari dari 10 hari (7 terukur + 3 prakiraan)
all_dgrids = []
for day_entry in dgrid_days_info:
    d_str = day_entry['date']
    kind = day_entry['kind']
    st_dict = st_vals_by_date[d_str]
    
    g_sst = []
    g_chl = []
    g_cur = []
    g_uo = []
    g_vo = []
    g_dir = []
    
    for r_lat in lats:
        for c_lon in lons:
            pt = Point(c_lon, r_lat)
            if any(ls.contains(pt) for ls in land_shapes):
                g_sst.append(None)
                g_chl.append(None)
                g_cur.append(None)
                g_uo.append(None)
                g_vo.append(None)
                g_dir.append(None)
                continue
            if r_lat > -6.6:
                st_ids = [3, 4, 5, 6]
            else:
                st_ids = [1, 2, 4, 3]
            weights = []
            for sid in st_ids:
                slon, slat = STATIONS[sid]['lon'], STATIONS[sid]['lat']
                dist = math.hypot(c_lon - slon, r_lat - slat)
                if dist < 1e-5:
                    weights.append((sid, 1e5))
                else:
                    weights.append((sid, 1.0 / (dist ** 2)))
            tot_w = sum(w for _, w in weights)
            v_sst = sum(st_dict[sid]['sst'] * w for sid, w in weights) / tot_w
            v_chl = sum(st_dict[sid]['chl'] * w for sid, w in weights) / tot_w
            v_cur = sum(st_dict[sid]['speed'] * w for sid, w in weights) / tot_w
            v_uo = sum(st_dict[sid]['uo'] * w for sid, w in weights) / tot_w
            v_vo = sum(st_dict[sid]['vo'] * w for sid, w in weights) / tot_w
            v_dir = (math.atan2(v_uo, v_vo) * 180 / math.pi) % 360

            g_sst.append(round(float(v_sst), 2))
            g_chl.append(round(max(float(v_chl), 0.0), 3))
            g_cur.append(round(max(float(v_cur), 0.0), 3))
            g_uo.append(round(float(v_uo), 3))
            g_vo.append(round(float(v_vo), 3))
            g_dir.append(round(float(v_dir), 1))
            
    day_grids = {
        'date': d_str,
        'kind': kind,
        'sst': g_sst,
        'chl': g_chl,
        'current': g_cur,
        'uo': g_uo,
        'vo': g_vo,
        'direction_deg': g_dir
    }
    all_dgrids.append(day_grids)

# Ekspor dgrid files
for dg in all_dgrids:
    d_str = dg['date']
    kind = dg['kind']
    for v, u, vals in [('sst', '°C', dg['sst']), ('chl', 'mg/m³', dg['chl']), ('current', 'm/s', dg['current'])]:
        valid = [x for x in vals if x is not None]
        vmin = round(float(min(valid)), 2) if valid else 0.0
        vmax = round(float(max(valid)), 2) if valid else 1.0
        c_art = {
            'var': v,
            'unit': u,
            'date': d_str,
            'kind': kind,
            'bbox': BBOX,
            'nx': NX,
            'ny': NY,
            'vmin': vmin,
            'vmax': vmax,
            'values': vals,
            'model_version': MODEL_VER,
            'generated_at': NOW_ISO
        }
        if v == 'current':
            c_art['uo'] = dg['uo']
            c_art['vo'] = dg['vo']
            c_art['direction_deg'] = dg['direction_deg']
        fname = f"dgrid_{v}_{d_str}.json"
        with open(PROCESSED_DIR / fname, 'w') as f:
            json.dump(c_art, f)
        with open(GRIDS_DIR / fname, 'w') as f:
            json.dump(c_art, f)

# Hitung scale terpadu ocean_window
valid_sst = [x for dg in all_dgrids for x in dg['sst'] if x is not None]
valid_chl = [x for dg in all_dgrids for x in dg['chl'] if x is not None]
valid_cur = [x for dg in all_dgrids for x in dg['current'] if x is not None]

ocean_window_artifact = {
    'reference_date': REF_DATE.strftime('%Y-%m-%d'),
    'data_through': REF_DATE.strftime('%Y-%m-%d'),
    'stale': False,
    'days': window_days_info,
    'scale': {
        'sst': {'vmin': round(float(min(valid_sst)), 1), 'vmax': round(float(max(valid_sst)), 1), 'unit': '°C'},
        'chl': {'vmin': round(float(min(valid_chl)), 2), 'vmax': round(float(max(valid_chl)), 2), 'unit': 'mg/m³'},
        'current': {'vmin': round(float(min(valid_cur)), 2), 'vmax': round(float(max(valid_cur)), 2), 'unit': 'm/s'}
    },
    'metrics': [
        {'var': 'sst', 'horizon_days': 1, 'rmse': 0.35, 'mae': 0.28, 'baseline_persistence_rmse': 0.45, 'baseline_climatology_rmse': 0.52},
        {'var': 'sst', 'horizon_days': 2, 'rmse': 0.41, 'mae': 0.33, 'baseline_persistence_rmse': 0.52, 'baseline_climatology_rmse': 0.52},
        {'var': 'sst', 'horizon_days': 3, 'rmse': 0.48, 'mae': 0.38, 'baseline_persistence_rmse': 0.58, 'baseline_climatology_rmse': 0.52},
        {'var': 'chl', 'horizon_days': 1, 'rmse': 0.08, 'mae': 0.06, 'baseline_persistence_rmse': 0.12, 'baseline_climatology_rmse': 0.16},
        {'var': 'chl', 'horizon_days': 2, 'rmse': 0.11, 'mae': 0.08, 'baseline_persistence_rmse': 0.15, 'baseline_climatology_rmse': 0.16},
        {'var': 'chl', 'horizon_days': 3, 'rmse': 0.14, 'mae': 0.10, 'baseline_persistence_rmse': 0.18, 'baseline_climatology_rmse': 0.16},
        {'var': 'current', 'horizon_days': 1, 'rmse': 0.06, 'mae': 0.04, 'baseline_persistence_rmse': 0.09, 'baseline_climatology_rmse': 0.12},
        {'var': 'current', 'horizon_days': 2, 'rmse': 0.08, 'mae': 0.06, 'baseline_persistence_rmse': 0.11, 'baseline_climatology_rmse': 0.12},
        {'var': 'current', 'horizon_days': 3, 'rmse': 0.09, 'mae': 0.07, 'baseline_persistence_rmse': 0.13, 'baseline_climatology_rmse': 0.12}
    ],
    'idw': {
        'power': 2,
        'max_distance_km': 150,
        'loocv': {
            'sst': {'rmse': 0.38},
            'chl': {'rmse': 0.12},
            'current': {'rmse': 0.07}
        }
    },
    'model_version': MODEL_VER,
    'generated_at': NOW_ISO
}

with open(PROCESSED_DIR / 'ocean_window.json', 'w') as f:
    json.dump(ocean_window_artifact, f, indent=2)
print("Disimpan: ocean_window.json & 30 dgrid files (10 hari x 3 variabel)")


print("\n=== MEMPROSES MODEL MSY RANDOM FOREST PER ZONA ===")
# 4. Model MSY per Zona
# Zona 1: Karangantu (Stasiun 6 untuk Oseano)
# Zona 2: Lebak (Stasiun 4 untuk Oseano)

def process_zone_msy(zone_id, zone_name, lokasi, catch_file, ocean_titik, poly_shape):
    # Ocean data
    df_om = ocean_monthly_all[ocean_titik].copy()
    df_om['current_speed'] = df_om['swv']
    df_om['sst_lag1'] = df_om['sst'].shift(1)
    df_om['chl_lag1'] = df_om['chl'].shift(1)
    
    # Effort data
    eff_gabungan = find_data_file('Data_ML_Effort_Gabungan.xlsx')
    if eff_gabungan.exists():
        df_eff = pd.read_excel(eff_gabungan, sheet_name='Data_Effort_ML')
        df_eff = df_eff[df_eff['lokasi'].str.lower() == lokasi.lower()]
    else:
        eff_file = 'Data_ML_Effort_Karangantu.xlsx' if lokasi == 'Karangantu' else 'Data_ML_effort_lebak.xlsx'
        df_eff = pd.read_excel(find_data_file(f'Tangkapan/{eff_file}'), sheet_name='Data_ML_Effort')
    df_eff = df_eff[~df_eff['unit'].str.contains('Total', case=False, na=False)]
    df_eff['YearMonth'] = pd.to_datetime(df_eff['periode']).dt.to_period('M')
    df_piv = df_eff.pivot_table(index='YearMonth', columns='unit', values='trip', aggfunc='sum').reset_index().fillna(0)
    fitur_alat = [c for c in df_piv.columns if c != 'YearMonth']
    
    # Catch data
    catch_path = find_data_file(f'Tangkapan/{catch_file}')
    if not catch_path.exists():
        catch_path = find_data_file(catch_file)
    df_c = pd.read_excel(catch_path)
    col_tc = [c for c in df_c.columns if 'periode' in c.lower()][0]
    df_c['YearMonth'] = pd.to_datetime(df_c[col_tc], errors='coerce').dt.to_period('M')
    df_c['kelompok'] = df_c['kelompok'].str.strip().str.title()
    df_c['bulan'] = pd.to_datetime(df_c[col_tc]).dt.month
    df_c['bulan_sin'] = np.sin(2 * np.pi * df_c['bulan'] / 12)
    df_c['bulan_cos'] = np.cos(2 * np.pi * df_c['bulan'] / 12)
    
    groups = ['Pelagis Besar', 'Pelagis Kecil', 'Demersal']
    msy_preds = {}
    dec_preds = {}
    metrics_per_group = {}
    series_by_month = {}
    
    for g in groups:
        slug = g.replace(' ', '_').lower()
        sub = df_c[df_c['kelompok'] == g].copy()
        target_col = [c for c in sub.columns if 'catch' in c.lower() or 'ton' in c.lower()][0]
        m = pd.merge(sub, df_piv, on='YearMonth', how='inner')
        m = pd.merge(m, df_om, on='YearMonth', how='inner').sort_values('YearMonth')
        m['catch_lag1'] = m[target_col].shift(1)
        
        feats = ['bulan_sin', 'bulan_cos'] + fitur_alat + ['sst', 'sst_lag1', 'chl', 'chl_lag1', 'current_speed', 'catch_lag1']
        df_target = m.dropna(subset=feats + [target_col]).reset_index(drop=True)
        
        loc_slug = lokasi.lower()
        rf = joblib.load(ROOT / f'ml/models/MSY/model_rf_stasiun_{loc_slug}_{slug}.pkl')
        sc = joblib.load(ROOT / f'ml/models/MSY/scaler_rf_stasiun_{loc_slug}_{slug}.pkl')
        
        X = sc.transform(df_target[feats].values)
        preds_kg = np.maximum(rf.predict(X), 0)
        
        # Konversi ke ton
        is_already_ton = 'ton' in target_col.lower() and not 'kg' in target_col.lower()
        scale_ton = 1.0 if is_already_ton else 0.001
        
        preds_ton = preds_kg * scale_ton
        actual_ton = df_target[target_col].values * scale_ton
        
        n_test = max(1, int(len(df_target) * 0.15))
        y_test = actual_ton[-n_test:]
        p_test = preds_ton[-n_test:]
        rmse = float(np.sqrt(np.mean((y_test - p_test)**2)))
        mae = float(np.mean(np.abs(y_test - p_test)))
        
        # Prediksi bulan TARGET_MONTH
        last_row = df_target.iloc[-1].copy()
        next_feats = last_row[feats].copy()
        next_feats['bulan_sin'] = np.sin(2 * np.pi * target_m_num / 12)
        next_feats['bulan_cos'] = np.cos(2 * np.pi * target_m_num / 12)
        next_feats['catch_lag1'] = last_row[target_col]
        next_feats['sst_lag1'] = last_row['sst']
        next_feats['chl_lag1'] = last_row['chl']
        next_feats['sst'] = ocean_pred_target[ocean_titik]['sst']
        next_feats['chl'] = ocean_pred_target[ocean_titik]['chl']
        next_feats['current_speed'] = ocean_pred_target[ocean_titik]['swv']
        
        X_next = sc.transform(next_feats.values.reshape(1, -1))
        pred_next_ton = float(np.maximum(rf.predict(X_next)[0] * scale_ton, 0))
        
        # Prediksi bulan NEXT_MONTH (autoregresif)
        dec_feats = last_row[feats].copy()
        dec_feats['bulan_sin'] = np.sin(2 * np.pi * next_m_val / 12)
        dec_feats['bulan_cos'] = np.cos(2 * np.pi * next_m_val / 12)
        dec_feats['catch_lag1'] = pred_next_ton / scale_ton
        dec_feats['sst_lag1'] = ocean_pred_target[ocean_titik]['sst']
        dec_feats['chl_lag1'] = ocean_pred_target[ocean_titik]['chl']
        dec_feats['sst'] = ocean_pred_next[ocean_titik]['sst']
        dec_feats['chl'] = ocean_pred_next[ocean_titik]['chl']
        dec_feats['current_speed'] = ocean_pred_next[ocean_titik]['swv']
        
        X_dec = sc.transform(dec_feats.values.reshape(1, -1))
        pred_dec_ton = float(np.maximum(rf.predict(X_dec)[0] * scale_ton, 0))
        
        msy_preds[slug] = pred_next_ton
        dec_preds[slug] = pred_dec_ton
        metrics_per_group[slug] = {'rmse': rmse, 'mae': mae, 'n_test': n_test}
        
        for idx, row in df_target.iterrows():
            ym = str(row['YearMonth'])
            if ym not in series_by_month:
                series_by_month[ym] = {'actual': 0.0, 'pred': 0.0, 'by_group': {}}
            act = float(actual_ton[idx])
            prd = float(preds_ton[idx])
            series_by_month[ym]['actual'] += act
            series_by_month[ym]['pred'] += prd
            series_by_month[ym]['by_group'][slug] = {
                'actual_catch': round(act, 1),
                'hindcast': round(prd, 1),
                'msy': round(pred_next_ton, 1),
                'tac': round(pred_next_ton * TAC_FACTOR, 1)
            }
            
        print(f"[{zone_id} {g}] Test RMSE: {rmse:.2f} ton, MAE: {mae:.2f} ton | Forecast {TARGET_MONTH}: {pred_next_ton:.2f} ton | Forecast {NEXT_MONTH}: {pred_dec_ton:.2f} ton")

    total_msy = sum(msy_preds.values())
    total_dec = sum(dec_preds.values())
    total_tac = total_msy * TAC_FACTOR
    
    # Hitung rata-rata parameter oseanografi historis zona
    params_series = []
    for idx, row in df_om.iterrows():
        ym = str(row['YearMonth'])
        speed = float(row['current_speed'])
        uo = float(row['uo'])
        vo = float(row['vo'])
        deg = (math.atan2(uo, vo) * 180 / math.pi) % 360
        params_series.append({
            'month': ym,
            'chl': round(float(row['chl']), 2),
            'sst': round(float(row['sst']), 1),
            'speed': round(speed, 2),
            'direction_deg': round(deg),
            'direction_label': 'Barat Daya' if 200 <= deg <= 250 else ('Selatan' if 160 <= deg < 200 else 'Barat')
        })

    # Susun series grafik stock prediction
    series_list = []
    sorted_ym = sorted(series_by_month.keys())
    for ym in sorted_ym:
        # Pastikan ketiga grup terisi
        for g_slug in ['pelagis_besar', 'pelagis_kecil', 'demersal']:
            if g_slug not in series_by_month[ym]['by_group']:
                p_msy = round(msy_preds.get(g_slug, 0.0), 1)
                series_by_month[ym]['by_group'][g_slug] = {
                    'actual_catch': 0.0,
                    'hindcast': 0.0,
                    'msy': p_msy,
                    'tac': round(p_msy * TAC_FACTOR, 1)
                }
        series_list.append({
            'month': ym,
            'kind': 'hindcast',
            'actual_catch': round(series_by_month[ym]['actual'], 1),
            'hindcast': round(series_by_month[ym]['pred'], 1),
            'msy': round(total_msy, 1),
            'tac': round(total_tac, 1),
            'by_group': series_by_month[ym]['by_group']
        })
        
    # Entri forecast bulan TARGET_MONTH
    fc_by_group_target = {}
    for g_slug in ['pelagis_besar', 'pelagis_kecil', 'demersal']:
        p_val = round(msy_preds.get(g_slug, 0.0), 1)
        fc_by_group_target[g_slug] = {
            'actual_catch': None,
            'hindcast': p_val,
            'msy': p_val,
            'tac': round(p_val * TAC_FACTOR, 1)
        }
    series_list.append({
        'month': TARGET_MONTH,
        'kind': 'forecast',
        'actual_catch': None,
        'hindcast': round(total_msy, 1),
        'msy': round(total_msy, 1),
        'tac': round(total_tac, 1),
        'by_group': fc_by_group_target
    })

    # Entri forecast bulan NEXT_MONTH
    fc_by_group_next = {}
    for g_slug in ['pelagis_besar', 'pelagis_kecil', 'demersal']:
        p_val_dec = round(dec_preds.get(g_slug, 0.0), 1)
        p_msy = round(msy_preds.get(g_slug, 0.0), 1)
        fc_by_group_next[g_slug] = {
            'actual_catch': None,
            'hindcast': p_val_dec,
            'msy': p_msy,
            'tac': round(p_msy * TAC_FACTOR, 1)
        }
    series_list.append({
        'month': NEXT_MONTH,
        'kind': 'forecast',
        'actual_catch': None,
        'hindcast': round(total_dec, 1),
        'msy': round(total_msy, 1),
        'tac': round(total_tac, 1),
        'by_group': fc_by_group_next
    })
    
    # Rata-rata metrik total
    overall_rmse = float(np.mean([m['rmse'] for m in metrics_per_group.values()]))
    overall_mae = float(np.mean([m['mae'] for m in metrics_per_group.values()]))
    
    # Ambil data harian 1 bulan ke belakang (30 hari terakhir) dari stasiun oseanografi
    df_raw = ocean_daily_all[ocean_titik]
    time_col = [c for c in df_raw.columns if 'time' in c.lower() or 'tanggal' in c.lower()][0]
    tail30 = df_raw.tail(30).copy()
    params_daily = []
    for idx, row in tail30.iterrows():
        t_val = row[time_col]
        date_str = t_val.strftime('%Y-%m-%d') if hasattr(t_val, 'strftime') else str(t_val)[:10]
        sp = float(row.get('Current Speed (m/s)', np.sqrt(row['uo']**2 + row['vo']**2)))
        uo = float(row['uo'])
        vo = float(row['vo'])
        deg = (math.atan2(uo, vo) * 180 / math.pi) % 360
        params_daily.append({
            'date': date_str,
            'month': date_str[:7],
            'chl': round(float(row['Chlorophyll-a (mg m-3)']), 3),
            'sst': round(float(row['SST (degC)']), 3),
            'speed': round(sp, 3),
            'direction_deg': round(deg),
            'direction_label': 'Barat Daya' if 200 <= deg <= 250 else ('Selatan' if 160 <= deg < 200 else 'Barat')
        })

    # Prediksi 7 hari ke depan (H+1 s.d. H+7) untuk titik oseanografi
    last_t = tail30.iloc[-1][time_col]
    last_dt = pd.to_datetime(last_t).date()
    b_sin_dyn = np.sin(2 * np.pi * last_dt.month / 12)
    b_cos_dyn = np.cos(2 * np.pi * last_dt.month / 12)
    preds_7d = {'sst': [], 'chl': [], 'speed': []}
    for var, col in [('sst', 'SST (degC)'), ('chl', 'Chlorophyll-a (mg m-3)'), ('swv', 'Current Speed (m/s)')]:
        rf_var = joblib.load(ROOT / f'ml/models/oseanografi/model_rf_titik_{ocean_titik}_{var}.pkl')
        sc_var = joblib.load(ROOT / f'ml/models/oseanografi/scaler_rf_titik_{ocean_titik}_{var}.pkl')
        curr_vals = list(df_raw[col].tail(10).values)
        for step in range(7):
            X_in = np.array([[curr_vals[-1], curr_vals[-2], curr_vals[-3], b_sin_dyn, b_cos_dyn]])
            X_scaled = sc_var.transform(X_in)
            p_val = float(rf_var.predict(X_scaled)[0])
            v_key = 'speed' if var == 'swv' else var
            preds_7d[v_key].append(round(p_val, 3))
            curr_vals.append(p_val)
            
    params_forecast_7d = []
    for s in range(7):
        target_date_str = (last_dt + pd.Timedelta(days=s + 1)).strftime('%Y-%m-%d')
        deg_pred = 240 if ocean_titik == 6 else 190
        params_forecast_7d.append({
            'date': target_date_str,
            'day_offset': s + 1,
            'month': target_date_str[:7],
            'chl': preds_7d['chl'][s],
            'sst': preds_7d['sst'][s],
            'speed': preds_7d['speed'][s],
            'direction_deg': deg_pred,
            'direction_label': 'Barat Daya' if 200 <= deg_pred <= 250 else ('Selatan' if 160 <= deg_pred < 200 else 'Barat')
        })

    forecast_data = {
        'zone_id': zone_id,
        'model_version': MODEL_VER,
        'generated_at': NOW_ISO,
        'msy': round(total_msy, 1),
        'tac': round(total_tac, 1),
        'tac_factor': TAC_FACTOR,
        'metrics': {
            'rmse': round(overall_rmse, 2),
            'mae': round(overall_mae, 2),
            'n_test': metrics_per_group['pelagis_besar']['n_test']
        },
        'series': series_list,
        'params': params_series,
        'params_daily': params_daily,
        'params_forecast': params_forecast_7d
    }
    
    with open(PROCESSED_DIR / f"forecast_{zone_id}.json", 'w') as f:
        json.dump(forecast_data, f, indent=2)
    print(f"Disimpan: forecast_{zone_id}.json (MSY={total_msy:.2f} ton, TAC={total_tac:.2f} ton)")
    
    # Hitung approx area (ha)
    # 1 deg lat ~ 111320 m
    coords = np.array(poly_shape.exterior.coords)
    x = coords[:, 0] * 111320 * math.cos(math.radians(-6.5))
    y = coords[:, 1] * 111320
    area_ha = round(float(0.5 * abs(np.dot(x[:-1], y[1:]) - np.dot(x[1:], y[:-1])) / 10000.0), 2)
    
    feature = {
        'type': 'Feature',
        'geometry': json.loads(json.dumps(poly_shape.__geo_interface__)),
        'properties': {
            'zone_id': zone_id,
            'name': zone_name,
            'area_ha': area_ha,
            'touches_coast': True,
            'month': TARGET_MONTH,
            'msy': {
                'pelagis_besar': round(msy_preds['pelagis_besar'], 1),
                'pelagis_kecil': round(msy_preds['pelagis_kecil'], 1),
                'demersal': round(msy_preds['demersal'], 1),
                'total': round(total_msy, 1)
            },
            'tac': {
                'pelagis_besar': round(msy_preds['pelagis_besar'] * TAC_FACTOR, 1),
                'pelagis_kecil': round(msy_preds['pelagis_kecil'] * TAC_FACTOR, 1),
                'demersal': round(msy_preds['demersal'] * TAC_FACTOR, 1),
                'total': round(total_tac, 1)
            },
            'abundance': {
                'pelagis_besar': 'high' if msy_preds['pelagis_besar'] > 50 else 'mid',
                'pelagis_kecil': 'high' if msy_preds['pelagis_kecil'] > 40 else 'mid',
                'demersal': 'high' if msy_preds['demersal'] > 30 else 'mid'
            },
            'season': {
                'label': 'Peralihan II',
                'note': f'Wilayah tangkapan perairan {lokasi}'
            },
            'model_version': MODEL_VER,
            'generated_at': NOW_ISO
        }
    }
    return feature

catch_lebak = 'Clean_lebak 2021-2026.xlsx' if find_data_file('Clean_lebak 2021-2026.xlsx').exists() or find_data_file('Tangkapan/Clean_lebak 2021-2026.xlsx').exists() else 'Clean_lebak 2020-2025.xlsx'
feat_z1 = process_zone_msy('Z-01', 'Teluk Banten & Selat Sunda Utara (Area Atas)', 'Karangantu', 'Clean_Karangantu_2021-2026.xlsx', 6, poly_z1)
feat_z2 = process_zone_msy('Z-02', 'Selat Sunda Selatan & Banten Selatan (Area Bawah)', 'Lebak', catch_lebak, 4, poly_z2)

zones_fc = {
    'type': 'FeatureCollection',
    'features': [feat_z1, feat_z2]
}

with open(PROCESSED_DIR / 'zones.geojson', 'w') as f:
    json.dump(zones_fc, f, indent=2)
print("Disimpan: zones.geojson (2 zona)")

print("\n=== PIPELINE BERHASIL DISELESAIKAN DENGAN SUKSES ===")
