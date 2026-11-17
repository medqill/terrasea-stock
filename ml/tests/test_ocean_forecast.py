"""Tes 05a_ocean_forecast: tanpa torch (fungsi data murni)."""
import importlib.util
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

_spec = importlib.util.spec_from_file_location("ocean05a", Path(__file__).resolve().parents[1] / "05a_ocean_forecast.py")
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)


def test_tidak_ada_chl_atau_speed_negatif():
    out = mod.postprocess(np.array([-5.0, 0.0, 2.0]), np.array([28.0, 29.0, 30.0]), np.array([-0.5, 0, 0.3]), np.array([-0.4, 0, 0.1]))
    assert (out["chl"] >= 0).all() and (out["speed"] >= 0).all()


def test_scaler_hanya_melihat_data_latih():
    idx = pd.date_range("2024-11-01", "2025-03-01")
    df = pd.DataFrame(np.random.default_rng(0).normal(size=(len(idx), 6)), index=idx, columns=mod.FEATURES)
    df.loc["2025-01-01":] += 1000.0  # data uji ekstrem
    sc = mod.fit_scaler({"T1": df}, pd.Timestamp("2024-12-31"))
    assert np.allclose(sc.mean_, df.loc[:"2024-12-31"].mean().to_numpy())
    assert (np.abs(sc.mean_) < 10).all()


def test_urutan_split():
    sp = mod.split_dates(mod.load_config())
    assert sp["val_start"] <= sp["train_end"] < sp["test_start"] <= sp["test_end"] < sp["holdout_start"]


def test_split_tidak_kronologis_ditolak():
    cfg = mod.load_config()
    cfg["split"]["test_start"] = "2024-06-01"
    with pytest.raises(ValueError):
        mod.split_dates(cfg)


def test_urutan_tanggal_latih_validasi_uji():
    cfg = mod.load_config()
    sp = mod.split_dates(cfg)
    W, H = cfg["model"]["window_days"], cfg["model"]["horizon_days"]
    dates = pd.date_range("2023-01-01", "2025-06-30")
    idx = np.arange(W - 1, len(dates))
    tr, va = mod.origin_masks(dates, idx, H, sp)
    assert tr.any() and va.any()
    assert dates[idx[tr] + H].max() < sp["val_start"]            # target latih < validasi
    assert dates[idx[va]].min() >= sp["val_start"]
    assert dates[idx[va] + H].max() <= sp["train_end"] < sp["test_start"]  # validasi < uji


def test_horizon_mencukupi():
    cfg = mod.load_config()
    H = cfg["model"]["horizon_days"]
    assert mod.required_horizon(date(2026, 11, 10), date(2026, 11, 8)) == 5
    assert mod.check_horizon(date(2026, 11, 10), date(2026, 10, 20), H) == 24
    assert mod.check_horizon(date(2026, 11, 10), date(2026, 11, 20), H) == 0
    with pytest.raises(mod.HorizonError):
        mod.check_horizon(date(2026, 11, 10), date(2026, 9, 1), H)


def test_stale():
    assert mod.is_stale(date(2026, 11, 10), date(2026, 11, 2))
    assert not mod.is_stale(date(2026, 11, 10), date(2026, 11, 3))


def test_rentang_lengkap_memakai_ekor_dan_celah_diisi():
    idx = pd.date_range("2025-01-01", periods=300)
    mk = lambda: pd.DataFrame({"chl": 1.0, "sst": 29.0, "uo": 0.1, "vo": 0.0}, index=idx)  # noqa: E731
    a, b = mk(), mk()
    a.iloc[100:101] = np.nan   # celah 1 hari: diisi interpolasi
    a.iloc[150:157] = np.nan   # celah 7 hari: memotong rentang
    a.iloc[-3:] = np.nan
    b.iloc[-3:] = np.nan
    panel = {s: g.interpolate(limit=2, limit_area="inside") for s, g in {"T1": a, "T2": b}.items()}
    run = mod.complete_run(panel, min_days=100)
    assert run["T1"].index[-1] == idx[-4]
    assert run["T1"].index[0] > idx[150]
    assert run["T1"].notna().all().all()


def test_target_nan_melewati_akhir_deret():
    xs = np.arange(20 * 6, dtype=np.float32).reshape(20, 6)
    idx, X = mod.make_windows(xs, 5)
    Y = mod.make_targets(xs, idx, 4)
    assert X.shape == (16, 5, 6) and Y.shape == (16, 4, 4)
    assert np.isnan(Y[-1]).all() and not np.isnan(Y[0]).any()
