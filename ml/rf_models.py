"""Pemuat model RF per (wilayah, kelompok ikan). BERKAS BARU, milik Nazma (ml/).

Letakkan pkl di ml/models/ dengan nama: model_rf_stasiun_{wilayah}_{kelompok}.pkl dan
scaler_rf_stasiun_{wilayah}_{kelompok}.pkl. Dipanggil dari skrip pipeline Python (mis. 02_*.py / 06_export.py),
BUKAN dari Express dan BUKAN dari request handler (AGENTS.md).

pkl bisa menjalankan kode saat dimuat: hanya muat berkas buatan tim sendiri, jangan pernah dari unggahan pengguna.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import joblib
import numpy as np
import sklearn

MODEL_DIR = Path(__file__).resolve().parent / "models"
REGIONS = ("karangantu", "lebak")
GROUPS = ("pelagis_besar", "pelagis_kecil", "demersal")

# WAJIB DIISI dari kode pelatihan: urutan 16 kolom persis seperti saat scaler.fit / model.fit.
# Model dilatih dari numpy (tanpa feature_names_in_), jadi urutan tidak bisa dibaca dari pkl.
FEATURE_ORDER: list[str] | None = None


def _path(kind: str, region: str, group: str) -> Path:
    return MODEL_DIR / f"{kind}_rf_stasiun_{region}_{group}.pkl"


def load_pair(region: str, group: str):
    if region not in REGIONS or group not in GROUPS:
        raise ValueError(f"wilayah/kelompok tidak dikenal: {region}/{group}")
    model, scaler = joblib.load(_path("model", region, group)), joblib.load(_path("scaler", region, group))
    if model.n_features_in_ != scaler.n_features_in_:
        raise ValueError("jumlah fitur model dan scaler tidak sama")
    return model, scaler


def predict_catch(region: str, group: str, X) -> np.ndarray:
    """X: DataFrame dengan kolom FEATURE_ORDER (disarankan) atau array (n, 16) dengan urutan yang sama.
    Keluaran: tangkapan dalam satuan target saat pelatihan (dari uji: skala kg/bulan, tanpa scaler target)."""
    model, scaler = load_pair(region, group)
    if hasattr(X, "columns"):
        if FEATURE_ORDER is None:
            raise RuntimeError("Isi FEATURE_ORDER dari kode pelatihan sebelum memakai DataFrame.")
        X = X[FEATURE_ORDER].to_numpy(dtype=float)
    X = np.asarray(X, dtype=float)
    if X.shape[1] != model.n_features_in_:
        raise ValueError(f"butuh {model.n_features_in_} fitur, diberi {X.shape[1]}")
    return np.clip(model.predict(scaler.transform(X)), 0, None)  # prediksi tidak boleh negatif


def manifest() -> dict:
    """Jejak model untuk model_version: sha256 tiap berkas dan versi scikit-learn saat memuat."""
    out = {"sklearn": sklearn.__version__, "files": {}}
    for p in sorted(MODEL_DIR.glob("*.pkl")):
        out["files"][p.name] = hashlib.sha256(p.read_bytes()).hexdigest()[:16]
    return out


if __name__ == "__main__":
    print(json.dumps(manifest(), indent=1))
