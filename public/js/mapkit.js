// Bagian peta yang dipakai Marine Stock dan minimap Download Data.
import { api } from './api.js';
import { cssVar, hexToRgb } from './dom.js';

export const VARS = {
  sst: { label: 'Suhu permukaan laut (SST)', unit: '°C', ramp: 'sst', n: 5, d: 1 },
  chl: { label: 'Klorofil-a', unit: 'mg/m³', ramp: 'chl', n: 4, d: 2 },
  current: { label: 'Kecepatan arus', unit: 'm/s', ramp: 'cur', n: 4, d: 2 },
  bathymetry: { label: 'Batimetri (Kedalaman)', unit: 'm', ramp: 'bathy', n: 5, d: 0 }
};
export const rampColors = (key) => Array.from({ length: VARS[key].n }, (_, i) => cssVar(`--${VARS[key].ramp}-${i}`));

export function colorAt(stops, t) {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]), f = x - i;
  return a.map((v, k) => Math.round(v + (b[k] - v) * f));
}

export function makePanes(map, withPin = true) {
  const pane = (name, z, interactive = true) => { const p = map.createPane(name); p.style.zIndex = z; if (!interactive) p.style.pointerEvents = 'none'; };
  // Urutan z-index:
  // 1. grid (410, interpolasi laut di dasar)
  // 2. land (420, daratan Indonesia putih solid menutupi interpolasi)
  // 3. eco (430, terumbu karang / lamun)
  // 4. zones (440, zona Z-01 & Z-02 di atas daratan & di atas interpolasi)
  // 5. pin (460, pinmarker)
  pane('grid', 410, false);
  pane('land', 420, false);
  pane('eco', 430);
  pane('zones', 440);
  if (withPin) pane('pin', 460);
}

export async function addBasemap(map) {
  let key = null;
  let mapId = null;
  try {
    const cfg = await api('/config');
    key = cfg.maptilerKey;
    mapId = cfg.maptilerMapId;
  } catch { /* pakai fallback */ }

  if (key) {
    // Pada MapTiler Cloud akun gratis, custom map ID (UUID) menghasilkan tile error "Invalid key"
    // karena raster tile hanya diizinkan untuk style resmi (seperti dataviz-dark).
    const isCustomUuid = mapId && /^[0-9a-f-]{36}$/i.test(mapId);
    const primaryId = (mapId && !isCustomUuid) ? mapId : 'dataviz-dark';
    const primaryLayer = L.tileLayer(`https://api.maptiler.com/maps/${encodeURIComponent(primaryId)}/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`, {
      tileSize: 512,
      zoomOffset: -1,
      maxZoom: 18,
      attribution: '© MapTiler © OpenStreetMap'
    });

    let failed = false;
    primaryLayer.on('tileerror', () => {
      if (failed) return;
      failed = true;
      primaryLayer.remove();

      // Bila style kustom ditolak (mis. batas akun gratis MapTiler), fallback ke dataviz-dark standar lalu CARTO
      if (primaryId !== 'dataviz-dark') {
        const fallbackMaptiler = L.tileLayer(`https://api.maptiler.com/maps/dataviz-dark/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`, {
          tileSize: 512,
          zoomOffset: -1,
          maxZoom: 18,
          attribution: '© MapTiler © OpenStreetMap'
        }).addTo(map);

        fallbackMaptiler.on('tileerror', () => {
          fallbackMaptiler.remove();
          L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 18, attribution: '© CARTO © OpenStreetMap' }).addTo(map);
        });
      } else {
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 18, attribution: '© CARTO © OpenStreetMap' }).addTo(map);
      }
    });

    primaryLayer.addTo(map);
  } else {
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 18, attribution: '© CARTO © OpenStreetMap' }).addTo(map);
  }
}

export async function addLand(map) {
  try {
    const geo = await api('/land');
    if (!geo || !geo.features || geo.features.length === 0) return null;
    const layer = L.geoJSON(geo, {
      pane: 'land',
      interactive: false,
      style: {
        color: '#E2E8F0', // border tipis abu-abu terang
        weight: 1,
        fillColor: '#FFFFFF', // putih solid sesuai permintaan user
        fillOpacity: 1
      }
    }).addTo(map);
    return layer;
  } catch (err) {
    console.error('Gagal memuat layer daratan:', err);
    return null;
  }
}

/** Gambar grid ke kanvas lalu jadikan overlay dengan opasitas 0,75 agar garis pantai tetap terlihat. */
export function gridOverlay(grid, key, scaleOverride = null) {
  const stops = rampColors(key);
  const cv = document.createElement('canvas');
  cv.width = grid.nx; cv.height = grid.ny;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(grid.nx, grid.ny);
  const vmin = scaleOverride?.vmin ?? grid.vmin;
  const vmax = scaleOverride?.vmax ?? grid.vmax;
  const span = vmax - vmin || 1;
  grid.values.forEach((v, i) => {
    if (v === null) return;
    const [r, g, b] = colorAt(stops, (v - vmin) / span);
    img.data.set([r, g, b, 255], i * 4);
  });
  ctx.putImageData(img, 0, 0);
  const [w, s, e, n] = grid.bbox;
  return L.imageOverlay(cv.toDataURL(), [[s, w], [n, e]], { pane: 'grid', opacity: 0.75, interactive: false });
}

export const zoneStyle = (selected, zoneId = null) => {
  const blue = '#00D2FF';
  return {
    pane: 'zones',
    color: selected ? '#38BDF8' : blue,
    weight: selected ? 4 : 3,
    opacity: 1,
    fillColor: blue,
    fillOpacity: selected ? 0.45 : 0.20,
    dashArray: '10 7'
  };
};