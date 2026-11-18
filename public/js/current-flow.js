// Layer visualisasi aliran partikel arus laut (Sea Water Velocity Streamlines)
// Mengikuti arah vektor uo (zonal) dan vo (meridional) secara dinamis mirip Copernicus MyOcean PRO & Windy.

import { bilinear } from './gridlookup.js';
import { reducedMotion } from './dom.js';

/**
 * Ekstraksi titik sel laut yang valid (bukan darat) dari grid.
 */
export function extractValidWaterPoints(grid) {
  if (!grid || !grid.bbox || !grid.uo || !grid.vo) return [];
  const [west, south, east, north] = grid.bbox;
  const { nx, ny, uo, vo } = grid;
  const pts = [];
  const dLng = (east - west) / nx;
  const dLat = (north - south) / ny;

  for (let r = 0; r < ny; r++) {
    const lat = north - (r + 0.5) * dLat;
    for (let c = 0; c < nx; c++) {
      const idx = r * nx + c;
      const u = uo[idx], v = vo[idx];
      if (u != null && v != null && (u !== 0 || v !== 0)) {
        const lng = west + (c + 0.5) * dLng;
        pts.push({ lng, lat, u, v, dLng, dLat });
      }
    }
  }
  return pts;
}

/**
 * Hitung posisi koordinat berikutnya berdasarkan vektor kecepatan (m/s) dan faktor skala.
 */
export function calculateNextPosition(lng, lat, u, v, speedFactor) {
  if (u == null || v == null) return null;
  return {
    nextLng: lng + u * speedFactor,
    nextLat: lat + v * speedFactor
  };
}

/**
 * Hitung nilai opasitas garis berdasarkan magnitudo kecepatan arus.
 */
export function computeParticleAlpha(speed, minSpeed = 0.05, maxSpeed = 0.5) {
  const t = Math.min(1, Math.max(0, (speed - minSpeed) / (maxSpeed - minSpeed || 1)));
  return 0.35 + 0.55 * t;
}

/**
 * Leaflet Layer untuk animasi partikel arus laut real-time di atas elemen Canvas.
 */
export class CurrentFlowLayer {
  constructor(grid, options = {}) {
    this._grid = grid;
    this.options = {
      pane: 'currentFlow',
      particleCount: 900,
      baseSpeedFactor: 0.003,
      minAge: 40,
      maxAge: 90,
      trailFade: 0.07, // tingkat pudarnya ekor partikel (destination-out)
      ...options
    };

    this._uGrid = { ...grid, values: grid.uo };
    this._vGrid = { ...grid, values: grid.vo };
    this._validPoints = extractValidWaterPoints(grid);
    this._particles = [];
    this._animId = null;
    this._animating = false;
    this._canvas = null;
    this._ctx = null;
    this._map = null;
    this._boundOnMove = this._onMove.bind(this);
    this._boundOnResize = this._onResize.bind(this);
    this._boundOnZoomStart = this._onZoomStart.bind(this);
    this._boundOnZoomEnd = this._onZoomEnd.bind(this);
  }

  addTo(map) {
    if (!map) return this;
    this._map = map;
    this._initCanvas();
    this._initListeners();
    this._initParticles();
    this._start();
    return this;
  }

  remove() {
    this._stop();
    this._removeListeners();
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas);
    }
    this._canvas = null;
    this._ctx = null;
    this._map = null;
    return this;
  }

  _initCanvas() {
    const paneName = this.options.pane || 'currentFlow';
    let pane = this._map.getPane(paneName);
    if (!pane) {
      pane = this._map.createPane(paneName);
      pane.style.zIndex = '415';
      pane.style.pointerEvents = 'none';
    }

    this._canvas = document.createElement('canvas');
    this._canvas.className = 'current-flow-canvas';
    this._canvas.style.position = 'absolute';
    this._canvas.style.left = '0';
    this._canvas.style.top = '0';
    this._canvas.style.pointerEvents = 'none';

    this._ctx = this._canvas.getContext('2d');
    pane.appendChild(this._canvas);

    this._updateCanvasSize();
  }

  _updateCanvasSize() {
    if (!this._map || !this._canvas) return;
    const size = this._map.getSize();
    this._canvas.width = size.x;
    this._canvas.height = size.y;
    this._onMove();
  }

  _onMove() {
    if (!this._map || !this._canvas) return;
    const topLeft = this._map.containerPointToLayerPoint([0, 0]);
    if (window.L?.DomUtil?.setPosition) {
      window.L.DomUtil.setPosition(this._canvas, topLeft);
    } else {
      this._canvas.style.transform = `translate3d(${topLeft.x}px, ${topLeft.y}px, 0)`;
    }
  }

  _onResize() {
    this._updateCanvasSize();
  }

  _onZoomStart() {
    if (this._ctx && this._canvas) {
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    }
  }

  _onZoomEnd() {
    this._updateCanvasSize();
    this._initParticles();
  }

  _initListeners() {
    if (!this._map) return;
    this._map.on('move', this._boundOnMove);
    this._map.on('resize', this._boundOnResize);
    this._map.on('zoomstart', this._boundOnZoomStart);
    this._map.on('zoomend', this._boundOnZoomEnd);
  }

  _removeListeners() {
    if (!this._map) return;
    this._map.off('move', this._boundOnMove);
    this._map.off('resize', this._boundOnResize);
    this._map.off('zoomstart', this._boundOnZoomStart);
    this._map.off('zoomend', this._boundOnZoomEnd);
  }

  _initParticles() {
    this._particles = [];
    if (!this._validPoints.length) return;

    const count = this.options.particleCount;
    for (let i = 0; i < count; i++) {
      const p = this._spawnParticle();
      if (p) {
        // Acak umur awal agar tidak mati serempak
        p.age = Math.floor(Math.random() * p.maxAge);
        this._particles.push(p);
      }
    }
  }

  _spawnParticle() {
    if (!this._validPoints.length) return null;
    const ref = this._validPoints[Math.floor(Math.random() * this._validPoints.length)];
    const lng = ref.lng + (Math.random() - 0.5) * ref.dLng;
    const lat = ref.lat + (Math.random() - 0.5) * ref.dLat;
    const maxAge = this.options.minAge + Math.floor(Math.random() * (this.options.maxAge - this.options.minAge));
    return { lng, lat, age: 0, maxAge };
  }

  _respawn(p) {
    const fresh = this._spawnParticle();
    if (fresh) {
      p.lng = fresh.lng;
      p.lat = fresh.lat;
      p.age = 0;
      p.maxAge = fresh.maxAge;
    }
  }

  _start() {
    if (reducedMotion()) {
      // Jika user mengaktifkan reduced motion, hanya gambar snapshot sekali tanpa loop animasi
      this._renderFrame();
      return;
    }
    this._animating = true;
    this._animId = requestAnimationFrame(() => this._loop());
  }

  _stop() {
    this._animating = false;
    if (this._animId) {
      cancelAnimationFrame(this._animId);
      this._animId = null;
    }
  }

  _loop() {
    if (!this._animating) return;
    this._renderFrame();
    this._animId = requestAnimationFrame(() => this._loop());
  }

  _renderFrame() {
    if (!this._canvas || !this._ctx || !this._map) return;

    const ctx = this._ctx;
    const map = this._map;
    const width = this._canvas.width;
    const height = this._canvas.height;

    // Efek pudar jejak partikel (comet/streamline trail)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = `rgba(0, 0, 0, ${this.options.trailFade})`;
    ctx.fillRect(0, 0, width, height);

    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';

    // Sesuaikan faktor kecepatan dengan tingkat zoom agar kecepatan visual di layar tetap seimbang
    const zoom = map.getZoom();
    const speedFactor = this.options.baseSpeedFactor / Math.pow(2, zoom - 9);
    const [west, south, east, north] = this._grid.bbox;

    for (let i = 0; i < this._particles.length; i++) {
      const p = this._particles[i];

      if (p.age >= p.maxAge || p.lng < west || p.lng > east || p.lat < south || p.lat > north) {
        this._respawn(p);
        continue;
      }

      const u = bilinear(this._uGrid, p.lng, p.lat);
      const v = bilinear(this._vGrid, p.lng, p.lat);

      if (u == null || v == null) {
        this._respawn(p);
        continue;
      }

      const spd = Math.sqrt(u * u + v * v);
      if (spd < 0.01) {
        this._respawn(p);
        continue;
      }

      const pos = calculateNextPosition(p.lng, p.lat, u, v, speedFactor);
      if (!pos) {
        this._respawn(p);
        continue;
      }

      const curPt = map.latLngToContainerPoint([p.lat, p.lng]);
      const nextPt = map.latLngToContainerPoint([pos.nextLat, pos.nextLng]);

      // Lewati partikel yang berada di luar layar viewport kanvas
      if (
        (curPt.x < -20 && nextPt.x < -20) ||
        (curPt.x > width + 20 && nextPt.x > width + 20) ||
        (curPt.y < -20 && nextPt.y < -20) ||
        (curPt.y > height + 20 && nextPt.y > height + 20)
      ) {
        p.lng = pos.nextLng;
        p.lat = pos.nextLat;
        p.age++;
        continue;
      }

      const alpha = computeParticleAlpha(spd, this._grid.vmin || 0.05, this._grid.vmax || 0.6);
      ctx.strokeStyle = `rgba(224, 242, 254, ${alpha.toFixed(2)})`;
      ctx.lineWidth = 1.0 + (spd / (this._grid.vmax || 0.6)) * 0.8;

      ctx.beginPath();
      ctx.moveTo(curPt.x, curPt.y);
      ctx.lineTo(nextPt.x, nextPt.y);
      ctx.stroke();

      p.lng = pos.nextLng;
      p.lat = pos.nextLat;
      p.age++;
    }
  }
}

