#!/usr/bin/env python3
"""Prakiraan oseanografi harian (chl, sst, uo, vo) dengan LSTM multi-horizon.

Jalankan dari root repo:  python ml/05a_ocean_forecast.py [--reference-date YYYY-MM-DD]

Aturan (AGENTS.md / Fase 9):
- Split kronologis; scaler di-fit HANYA pada data latih; tanpa pengacakan antar-waktu.
- Keluaran langsung 30 hari per titik (bukan rekursif); ansambel seed tetap, simpangan baku = ketidakpastian.
- chl dikembalikan dari log1p dan dijepit >= 0; speed = sqrt(uo^2+vo^2).
- Evaluasi dibandingkan baseline persistensi dan klimatologi musiman; hasil dilaporkan apa adanya.
Berkas ini berdiri sendiri; 01_prepare.py..06_export.py tidak diubah.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import yaml
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = Path(__file__).resolve().parent / "config_ocean.yaml"
RAW = ["chl", "sst", "uo", "vo"]
FEATURES = ["chl_log", "sst", "uo", "vo", "doy_sin", "doy_cos"]  # 4 kolom pertama = target
N_TARGET = 4
REPORT_VARS = {"sst": "sst", "chl": "chl", "current": "speed"}  # nama di laporan -> kunci internal


class HorizonError(RuntimeError):
    pass


class DataError(RuntimeError):
    pass


# ------------------------------------------------------------------ konfigurasi & tanggal
def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def jakarta_today() -> date:
    return datetime.now(ZoneInfo("Asia/Jakarta")).date()


def required_horizon(reference_date: date, data_through: date) -> int:
    """Hari prakiraan yang dibutuhkan agar H+3 tercakup: (reference_date + 3) - data_through."""
    return (reference_date + timedelta(days=3) - data_through).days


def check_horizon(reference_date: date, data_through: date, max_horizon: int) -> int:
    need = required_horizon(reference_date, data_through)
    if need > max_horizon:
        raise HorizonError(
            f"Horizon yang dibutuhkan {need} hari melebihi batas {max_horizon} hari "
            f"(data terukur terakhir {data_through}, reference_date {reference_date}). "
            "Perbarui data observasi (import/ingest) lalu jalankan ulang."
        )
    return max(need, 0)


def is_stale(reference_date: date, data_through: date) -> bool:
    return (reference_date - data_through).days > 7


def split_dates(cfg: dict) -> dict:
    s = cfg["split"]
    train_end = pd.Timestamp(s["train_end"])
    sp = {
        "train_end": train_end,
        "val_start": train_end - pd.Timedelta(days=int(s["val_days"]) - 1),
        "test_start": pd.Timestamp(s["test_start"]),
        "test_end": pd.Timestamp(s["test_end"]),
        "holdout_start": pd.Timestamp(s["holdout_start"]),
    }
    if not (sp["val_start"] <= sp["train_end"] < sp["test_start"] <= sp["test_end"] < sp["holdout_start"]):
        raise ValueError("Urutan tanggal split harus latih < validasi(ujung latih) < uji < holdout")
    return sp


# ------------------------------------------------------------------ data
def load_panel(csv_path: Path, max_gap_days: int) -> dict:
    df = pd.read_csv(csv_path, parse_dates=["date"])
    full_idx = pd.date_range(df["date"].min(), df["date"].max(), freq="D")
    panel = {}
    for sid, g in df.sort_values("date").groupby("station_id"):
        g = g.drop_duplicates("date", keep="last").set_index("date")[RAW].reindex(full_idx)
        g.loc[g["chl"] < 0, "chl"] = np.nan
        panel[sid] = g.interpolate(method="linear", limit=max_gap_days, limit_area="inside")
    return panel


def complete_run(panel: dict, min_days: int) -> dict:
    """Rentang kontigu TERAKHIR saat semua titik dan keempat variabel terisi.
    Akhir rentang = data_through (asumsi: tanggal terakhir ketika SEMUA titik lengkap)."""
    ok = None
    for g in panel.values():
        m = g[RAW].notna().all(axis=1)
        ok = m if ok is None else (ok & m)
    if ok is None or not ok.any():
        raise DataError("Tidak ada tanggal dengan seluruh titik dan variabel terisi.")
    pos_end = ok.index.get_loc(ok[ok].index[-1])
    pos = pos_end
    while pos >= 0 and ok.iloc[pos]:
        pos -= 1
    idx = ok.index[pos + 1 : pos_end + 1]
    if len(idx) < min_days:
        raise DataError(f"Rentang lengkap hanya {len(idx)} hari (< {min_days}).")
    return {sid: g.loc[idx].copy() for sid, g in panel.items()}


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    ang = 2 * np.pi * df.index.dayofyear.to_numpy() / 365.25
    return pd.DataFrame(
        {
            "chl_log": np.log1p(df["chl"].to_numpy()),
            "sst": df["sst"].to_numpy(),
            "uo": df["uo"].to_numpy(),
            "vo": df["vo"].to_numpy(),
            "doy_sin": np.sin(ang),
            "doy_cos": np.cos(ang),
        },
        index=df.index,
    )


def fit_scaler(feats: dict, train_end: pd.Timestamp) -> StandardScaler:
    """Scaler di-fit HANYA pada baris dengan tanggal <= train_end."""
    rows = [f.loc[:train_end, FEATURES].to_numpy() for f in feats.values()]
    return StandardScaler().fit(np.concatenate(rows))


def make_windows(xs: np.ndarray, window: int):
    idx = np.arange(window - 1, len(xs))
    X = np.stack([xs[i - window + 1 : i + 1] for i in idx]).astype(np.float32)
    return idx, X


def make_targets(xs: np.ndarray, idx: np.ndarray, horizon: int) -> np.ndarray:
    """Y[k, h-1] = target hari idx[k]+h; NaN bila melewati akhir deret."""
    tgt = xs[:, :N_TARGET]
    Y = np.full((len(idx), horizon, N_TARGET), np.nan, dtype=np.float32)
    for k, i in enumerate(idx):
        n = min(horizon, len(tgt) - 1 - i)
        if n > 0:
            Y[k, :n] = tgt[i + 1 : i + 1 + n]
    return Y


def origin_masks(dates: pd.DatetimeIndex, idx: np.ndarray, horizon: int, sp: dict):
    """Mask sampel latih dan validasi. Semua target latih jatuh SEBELUM val_start;
    sampel validasi berasal dari val_start dengan target <= train_end."""
    pos_val = dates.searchsorted(sp["val_start"], side="left")
    pos_train_end = dates.searchsorted(sp["train_end"], side="right") - 1
    train = (idx + horizon) < pos_val
    val = (idx >= pos_val) & (idx + horizon <= pos_train_end)
    return train, val


# ------------------------------------------------------------------ pasca-proses
def postprocess(chl_log, sst, uo, vo) -> dict:
    chl = np.maximum(np.expm1(chl_log), 0.0)
    return {"chl": chl, "sst": sst, "uo": uo, "vo": vo, "speed": np.sqrt(uo**2 + vo**2)}


def inverse_targets(y_scaled: np.ndarray, scaler: StandardScaler) -> dict:
    z = y_scaled * scaler.scale_[:N_TARGET] + scaler.mean_[:N_TARGET]
    return postprocess(z[..., 0], z[..., 1], z[..., 2], z[..., 3])


def raw_series(df: pd.DataFrame) -> dict:
    return {"chl": df["chl"].to_numpy(), "sst": df["sst"].to_numpy(), "speed": np.sqrt(df["uo"] ** 2 + df["vo"] ** 2).to_numpy()}


def climatology(raw_train: pd.DataFrame, smooth_days: int) -> dict:
    doy = (raw_train.index.dayofyear.to_numpy() - 1) % 365
    out = {}
    for k, v in raw_series(raw_train).items():
        arr = pd.Series(v).groupby(doy).mean().reindex(range(365)).interpolate(limit_direction="both").to_numpy()
        if smooth_days > 1:
            ext = np.concatenate([arr[-smooth_days:], arr, arr[:smooth_days]])
            arr = np.convolve(ext, np.ones(smooth_days) / smooth_days, mode="same")[smooth_days:-smooth_days]
        out[k] = arr
    return out


# ------------------------------------------------------------------ model (torch dimuat malas)
def build_model(n_features: int, out_dim: int, cfg_m: dict):
    from torch import nn

    class Net(nn.Module):
        def __init__(self):
            super().__init__()
            layers = int(cfg_m["num_layers"])
            drop = float(cfg_m["dropout"])
            self.lstm = nn.LSTM(n_features, int(cfg_m["hidden_units"]), num_layers=layers, batch_first=True,
                                dropout=drop if layers > 1 else 0.0)
            self.drop = nn.Dropout(drop)
            self.head = nn.Linear(int(cfg_m["hidden_units"]), out_dim)

        def forward(self, x):
            o, _ = self.lstm(x)
            return self.head(self.drop(o[:, -1]))

    return Net()


def train_member(Xtr, Ytr, Xva, Yva, cfg_m: dict, seed: int):
    import torch
    from torch import nn

    torch.manual_seed(seed)
    torch.set_num_threads(int(cfg_m.get("torch_threads", 2)))
    H = Ytr.shape[1]
    model = build_model(Xtr.shape[2], H * N_TARGET, cfg_m)
    opt = torch.optim.Adam(model.parameters(), lr=float(cfg_m["lr"]))
    lossf = nn.MSELoss()
    xt, yt = torch.tensor(Xtr), torch.tensor(Ytr.reshape(len(Ytr), -1))
    xv, yv = torch.tensor(Xva), torch.tensor(Yva.reshape(len(Yva), -1))
    gen = torch.Generator().manual_seed(seed)
    bs, best, best_state, bad, epochs_run = int(cfg_m["batch_size"]), float("inf"), None, 0, 0
    for ep in range(int(cfg_m["epochs"])):
        model.train()
        perm = torch.randperm(len(xt), generator=gen)
        for b in range(0, len(perm), bs):
            ii = perm[b : b + bs]
            opt.zero_grad()
            loss = lossf(model(xt[ii]), yt[ii])
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
        model.eval()
        with torch.no_grad():
            vl = lossf(model(xv), yv).item()
        epochs_run = ep + 1
        if vl < best - 1e-5:
            best, bad = vl, 0
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        else:
            bad += 1
            if bad >= int(cfg_m["patience"]):
                break
    model.load_state_dict(best_state)
    return model, best, epochs_run


def predict(model, X: np.ndarray, horizon: int) -> np.ndarray:
    import torch

    model.eval()
    with torch.no_grad():
        out = model(torch.tensor(X, dtype=torch.float32)).numpy()
    return out.reshape(len(X), horizon, N_TARGET)


# ------------------------------------------------------------------ evaluasi
def _rows(acc: dict) -> list:
    rows = []
    rm = lambda x: float(np.sqrt(np.mean(x**2)))  # noqa: E731
    for v, byh in acc.items():
        for h, (em, ep, ec) in byh.items():
            if not em:
                continue
            em, ep, ec = (np.concatenate(x) for x in (em, ep, ec))
            if em.size == 0:
                continue
            rows.append({
                "var": v, "horizon_days": h, "n": int(em.size),
                "rmse": round(rm(em), 4), "mae": round(float(np.mean(np.abs(em))), 4),
                "baseline_persistence_rmse": round(rm(ep), 4), "baseline_climatology_rmse": round(rm(ec), 4),
                "beats_baselines": bool(rm(em) < rm(ep) and rm(em) < rm(ec)),
            })
    return rows


def evaluate_split(ev: dict, horizons: list, start: pd.Timestamp, end: pd.Timestamp):
    empty = lambda: {v: {h: ([], [], []) for h in horizons} for v in REPORT_VARS}  # noqa: E731
    agg, per = empty(), {}
    for sid, e in ev.items():
        T = len(e["dates"])
        od = e["dates"][e["idx"]]
        per[sid] = empty()
        for h in horizons:
            ti = e["idx"] + h
            td = e["dates"][np.minimum(ti, T - 1)]
            valid = np.asarray((od >= start) & (td <= end)) & (ti < T)
            if not valid.any():
                continue
            doy = (td[valid].dayofyear.to_numpy() - 1) % 365
            for v, k in REPORT_VARS.items():
                t = e["true"][k][valid, h - 1]
                m = e["pred"][k][valid, h - 1]
                p = e["pers"][k][valid]
                c = e["clim"][k][doy]
                ok = np.isfinite(t) & np.isfinite(m) & np.isfinite(p) & np.isfinite(c)
                for store in (agg[v][h], per[sid][v][h]):
                    store[0].append(m[ok] - t[ok])
                    store[1].append(p[ok] - t[ok])
                    store[2].append(c[ok] - t[ok])
    return _rows(agg), {sid: _rows(p) for sid, p in per.items()}


def verdict(rows: list) -> dict:
    out = {}
    for v in REPORT_VARS:
        r = [x for x in rows if x["var"] == v]
        out[v] = {
            "horizons_beating_both_baselines": [x["horizon_days"] for x in r if x["beats_baselines"]],
            "horizons_not_beating": [x["horizon_days"] for x in r if not x["beats_baselines"]],
        }
    return out


# ------------------------------------------------------------------ utama
def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, allow_nan=False)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reference-date", help="YYYY-MM-DD (bawaan: hari ini Asia/Jakarta)")
    args = ap.parse_args(argv)

    cfg = load_config()
    cm = cfg["model"]
    W, H = int(cm["window_days"]), int(cm["horizon_days"])
    ref = date.fromisoformat(args.reference_date) if args.reference_date else jakarta_today()

    try:
        panel = load_panel(ROOT / cfg["paths"]["raw_ocean_csv"], int(cfg["data"]["max_gap_days"]))
        run = complete_run(panel, int(cfg["data"]["min_series_days"]))
        data_through = next(iter(run.values())).index[-1].date()
        horizon_max = check_horizon(ref, data_through, H)
    except (HorizonError, DataError) as e:
        print(f"GAGAL: {e}", file=sys.stderr)
        return 1
    stale = is_stale(ref, data_through)
    if stale:
        print(f"PERINGATAN: data terukur terakhir {data_through} (> 7 hari sebelum {ref}); keluaran ditandai stale.")

    sp = split_dates(cfg)
    sids = sorted(run)
    feats = {s: build_features(run[s]) for s in sids}
    scaler = fit_scaler(feats, sp["train_end"])

    arr = {}
    Xtr, Ytr, Xva, Yva = [], [], [], []
    for s in sids:
        xs = scaler.transform(feats[s][FEATURES].to_numpy()).astype(np.float32)
        dates = feats[s].index
        idx, X = make_windows(xs, W)
        Y = make_targets(xs, idx, H)
        tr, va = origin_masks(dates, idx, H, sp)
        Xtr.append(X[tr]); Ytr.append(Y[tr]); Xva.append(X[va]); Yva.append(Y[va])
        arr[s] = {"xs": xs, "dates": dates, "idx": idx, "X": X, "Y": Y}
    Xtr, Ytr, Xva, Yva = (np.concatenate(a) for a in (Xtr, Ytr, Xva, Yva))
    print(f"Sampel latih {len(Xtr)}, validasi {len(Xva)}; rentang {feats[sids[0]].index[0].date()} s.d. {data_through}")
    if len(Xtr) < int(cm["min_train_samples"]) or len(Xva) == 0:
        print("GAGAL: sampel latih/validasi tidak mencukupi untuk split yang dikonfigurasi.", file=sys.stderr)
        return 1

    t0 = time.perf_counter()
    models, val_losses, epochs = [], [], []
    for i in range(int(cm["ensemble_size"])):
        m, vl, ep = train_member(Xtr, Ytr, Xva, Yva, cm, int(cfg["seed"]) + i)
        models.append(m); val_losses.append(round(vl, 5)); epochs.append(ep)
        print(f"  anggota {i + 1}: val_loss={vl:.4f}, epoch={ep}")
    train_seconds = time.perf_counter() - t0
    needs_decision = train_seconds > float(cm["max_train_minutes"]) * 60
    print(f"Lama pelatihan: {train_seconds:.0f} detik")
    if needs_decision:
        print("PERINGATAN: pelatihan > batas menit per eksekusi. TANYAKAN Nazma sebelum menjadwalkan harian "
              "(usul: latih mingguan, simpan bobot, inferensi harian).")

    # ---- evaluasi test (2025) dan holdout (2026) terhadap dua baseline
    horizons = [int(h) for h in cfg["eval"]["horizons"] if int(h) <= H]
    ev = {}
    for s in sids:
        a = arr[s]
        dates = a["dates"]
        sel = np.where(dates[a["idx"]] >= sp["test_start"])[0]
        if sel.size == 0:
            continue
        P = np.stack([predict(m, a["X"][sel], H) for m in models])  # (M,n,H,4)
        members = [inverse_targets(p, scaler) for p in P]
        pred = {"sst": np.mean([r["sst"] for r in members], 0), "chl": np.mean([r["chl"] for r in members], 0)}
        uo, vo = np.mean([r["uo"] for r in members], 0), np.mean([r["vo"] for r in members], 0)
        pred["speed"] = np.sqrt(uo**2 + vo**2)
        true = inverse_targets(a["Y"][sel], scaler)
        raw_all = raw_series(run[s])
        train_df = run[s].loc[: sp["train_end"]]
        ev[s] = {"dates": dates, "idx": a["idx"][sel], "pred": pred, "true": true,
                 "pers": {k: raw_all[k][a["idx"][sel]] for k in REPORT_VARS.values()},
                 "clim": climatology(train_df, int(cfg["eval"]["clim_smooth_days"]))}
    test_agg, test_per = evaluate_split(ev, horizons, sp["test_start"], sp["test_end"])
    hold_end = max(a["dates"][-1] for a in arr.values())
    hold_agg, hold_per = evaluate_split(ev, horizons, sp["holdout_start"], hold_end)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    version = f"ocean-lstm-{cfg['version']}"
    report = {
        "model_version": version, "generated_at": now, "reference_date": ref.isoformat(),
        "data_through": data_through.isoformat(), "training_seconds": round(train_seconds, 1),
        "needs_decision": needs_decision, "ensemble_val_loss": val_losses, "ensemble_epochs": epochs,
        "split": {k: str(v.date()) for k, v in sp.items()},
        "catatan": "Kesimpulan 'beats_baselines' dilaporkan apa adanya; jangan klaim model baik bila tidak mengalahkan kedua baseline.",
        "test": {"aggregate": test_agg, "per_station": test_per, "verdict": verdict(test_agg)},
        "holdout": {"aggregate": hold_agg, "per_station": hold_per, "verdict": verdict(hold_agg)},
    }
    write_json(ROOT / cfg["paths"]["report_dir"] / "ocean_forecast_metrics.json", report)
    for v, d in report["test"]["verdict"].items():
        print(f"  uji {v}: mengalahkan kedua baseline di horizon {d['horizons_beating_both_baselines']}; tidak di {d['horizons_not_beating']}")

    # ---- prakiraan 30 hari ke depan dari jendela terakhir tiap titik
    out = {"model_version": version, "generated_at": now, "reference_date": ref.isoformat(),
           "data_through": data_through.isoformat(), "stale": stale, "horizon_max": horizon_max,
           "horizon_days": H, "stations": {}}
    fdates = [(data_through + timedelta(days=i)).isoformat() for i in range(1, H + 1)]
    for s in sids:
        Xl = arr[s]["xs"][-W:][None].astype(np.float32)
        members = [inverse_targets(predict(m, Xl, H)[0], scaler) for m in models]
        st = {"dates": fdates}
        for k in ("sst", "chl", "uo", "vo"):
            st[k] = np.round(np.mean([r[k] for r in members], 0), 3).tolist()
            st[f"{k}_std"] = np.round(np.std([r[k] for r in members], 0), 3).tolist()
        speed = np.sqrt(np.array(st["uo"]) ** 2 + np.array(st["vo"]) ** 2)
        st["speed"] = np.round(speed, 3).tolist()
        st["speed_std"] = np.round(np.std([r["speed"] for r in members], 0), 3).tolist()
        out["stations"][s] = st
    write_json(ROOT / cfg["paths"]["out_dir"] / "ocean_forecast_stations.json", out)
    print(f"Selesai: prakiraan {H} hari untuk {len(sids)} titik; horizon dibutuhkan {horizon_max} hari.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
