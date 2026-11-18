import './layout.js';
import { api } from './api.js';
import { h, $, clear, cssVar, reducedMotion } from './dom.js';
import { svgIcon } from './icons.js';
import { GROUPS, abundBadge, fmt, fmtMonth, fmtDate, fixtureChip, dirLabel } from './labels.js';
import { VARS, rampColors, makePanes, addBasemap, addLand, gridOverlay, zoneStyle } from './mapkit.js';
import { lookupValue, speedAndDirection } from './gridlookup.js';

const sidebar = $('#sidebar'), toggleBtn = $('#sidebar-toggle'), panels = $('#panels'), lockbar = $('#lockbar');
let map, zonesFC, zoneLayer, gridLayer, ecoLayer, pinMarker, meta, ow = null;
let currentVar = 'sst', ecoOn = false, selected = null, locked = false;
let mode = 'legacy';      // 'ocean' = rentang waktu harian (ocean_window); 'legacy' = grid bulanan
let currentDay = null;    // entri ocean_window.days yang dipilih
let lastPoint = null;     // { latlng, inZone, abund }
let gridSeq = 0, pointSeq = 0;
const zoneLayers = new Map();
const gridCache = new Map(); // `${var}:${date}` -> Promise grid (dimuat lazy)

const fmtDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { dateStyle: 'medium' });
const kindOf = (d) => (d.kind === 'forecast' ? { sym: '●', text: 'Prakiraan (Random Forest)' } : { sym: '●', text: 'Terukur' });
const offsetName = (o) => (o === 0 ? 'Hari ini' : o < 0 ? `H${o}` : `H+${o}`);

function setCollapsed(c) {
  sidebar.classList.toggle('is-collapsed', c);
  toggleBtn.replaceChildren(svgIcon(c ? 'right' : 'left'));
  toggleBtn.setAttribute('aria-expanded', String(!c));
  toggleBtn.setAttribute('aria-label', c ? 'Buka panel layer' : 'Lipat panel layer');
}
toggleBtn.addEventListener('click', () => { if (!locked) setCollapsed(!sidebar.classList.contains('is-collapsed')); });

/* ---------- data harian: lazy + cache di memori klien ---------- */
function fetchDgrid(v, date) {
  const k = `${v}:${date}`;
  if (!gridCache.has(k)) gridCache.set(k, api(`/dgrids/${v}?date=${date}`).catch((e) => { gridCache.delete(k); throw e; }));
  return gridCache.get(k);
}

// RMSE uji terdekat dengan horizon h (metrik hanya ada untuk horizon tertentu).
function metricFor(v, h) {
  const list = (ow?.metrics ?? []).filter((m) => m.var === v);
  if (!list.length) return null;
  const dist = (m) => Math.abs(m.horizon_days - h);
  return list.reduce((b, m) => (dist(m) < dist(b) || (dist(m) === dist(b) && m.horizon_days > b.horizon_days) ? m : b));
}

/* ---------- layer variabel + legenda ---------- */
async function showVar(key) {
  currentVar = key;
  const my = ++gridSeq;
  const legend = $('#legend');
  try {
    let grid, scale;
    const notes = [];
    if (key === 'bathymetry') {
      grid = await api(`/grids/bathymetry?month=${meta?.month || '2026-11'}`);
      scale = { vmin: 0, vmax: Math.min(grid.vmax, 200) }; // skala visual fokus 0 s.d. 200m untuk batas demersal
      notes.push('Data Batimetri (GEBCO 2026). Kedalaman dasar laut dalam meter. Terang = dangkal, gelap = dalam.');
      notes.push('Kelimpahan demersal berbasis kedalaman: 40-60m (Sangat Berlimpah ▲), 0-40m (Berlimpah =), >60m (Kurang Berlimpah ▼).');
    } else if (mode === 'ocean') {
      grid = await fetchDgrid(key, currentDay.date);
      scale = ow.scale[key]; // skala TETAP untuk ketujuh hari
      const k = kindOf(currentDay);
      notes.push(`${fmtDay(currentDay.date)}. ${k.sym} ${k.text}. Interpolasi IDW dari 6 titik stasiun. Skala sama untuk semua hari.`);
      if (currentDay.kind === 'forecast') {
        const m = metricFor(key, currentDay.horizon_days);
        if (m) notes.push(`RMSE uji horizon ${m.horizon_days} hari: ${fmt(m.rmse, VARS[key].d + 1)} ${VARS[key].unit}.`);
      }
    } else {
      grid = await api(`/grids/${key}?month=${meta.month}`);
      scale = { vmin: grid.vmin, vmax: grid.vmax };
      notes.push(`Data ${fmtMonth(grid.month)}. Interpolasi IDW. Gelap = rendah, terang = tinggi.`);
    }
    if (my !== gridSeq) return;
    gridLayer?.remove();
    gridLayer = gridOverlay(grid, key, scale).addTo(map);
    const v = VARS[key], mid = (scale.vmin + scale.vmax) / 2;
    const bar = h('div', { class: 'legend__bar', role: 'img', 'aria-label': `Skala ${v.label} dari ${fmt(scale.vmin, v.d)} sampai ${fmt(scale.vmax, v.d)} ${v.unit}` });
    bar.style.background = `linear-gradient(to right, ${rampColors(key).join(',')})`;
    clear(legend).append(
      h('p', { class: 'label' }, `${v.label} (${v.unit})`), bar,
      h('div', { class: 'legend__ticks' }, h('span', {}, fmt(scale.vmin, v.d)), h('span', {}, fmt(mid, v.d)), h('span', {}, fmt(scale.vmax, v.d))),
      ...notes.map((t) => h('p', { class: 'legend__meta' }, t)));
  } catch (e) { if (my === gridSeq) clear(legend).append(h('p', { class: 'form-msg form-msg--error' }, e.message)); }
}

/* ---------- rentang waktu H-3..H+3 (Slider Timeline) ---------- */
function updateDayFromSlider(idx) {
  const d = ow.days[idx];
  if (!d) return;
  currentDay = d;
  const k = kindOf(d);

  $('#time-offset-badge').textContent = offsetName(d.offset);
  const statusEl = $('#time-status-badge');
  statusEl.textContent = `${k.sym} ${k.text}`;
  statusEl.className = `time-card__status ${d.kind === 'forecast' ? 'is-forecast' : 'is-observed'}`;
  $('#time-date-display').textContent = fmtDay(d.date);

  $('#time-prev').disabled = idx <= 0;
  $('#time-next').disabled = idx >= ow.days.length - 1;

  const ticks = $('#time-ticks').children;
  for (let i = 0; i < ticks.length; i++) {
    ticks[i].classList.toggle('is-active', i === idx);
  }

  showVar(currentVar);
  refreshPoint();
}

function setupTimeSlider() {
  const slider = $('#time-slider');
  const prevBtn = $('#time-prev');
  const nextBtn = $('#time-next');
  const ticksBox = clear($('#time-ticks'));

  prevBtn.replaceChildren(svgIcon('left'));
  nextBtn.replaceChildren(svgIcon('right'));

  slider.min = 0;
  slider.max = ow.days.length - 1;

  const initialIdx = ow.days.findIndex((d) => d.offset === currentDay.offset);
  slider.value = initialIdx >= 0 ? initialIdx : 0;

  ow.days.forEach((d, i) => {
    const span = h('span', {
      title: `${offsetName(d.offset)} (${fmtDay(d.date)})`,
      onclick: () => {
        slider.value = i;
        updateDayFromSlider(i);
      }
    }, `${d.date.slice(8)}/${d.date.slice(5, 7)}`);
    ticksBox.append(span);
  });

  slider.oninput = (e) => updateDayFromSlider(Number(e.target.value));
  prevBtn.onclick = () => {
    if (slider.value > 0) {
      slider.value--;
      updateDayFromSlider(Number(slider.value));
    }
  };
  nextBtn.onclick = () => {
    if (slider.value < ow.days.length - 1) {
      slider.value++;
      updateDayFromSlider(Number(slider.value));
    }
  };

  updateDayFromSlider(Number(slider.value));
}

async function initTimeWindow() {
  const tw = $('#time-window');
  try {
    ow = await api('/ocean-window');
    mode = 'ocean';
    currentDay = ow.days.find((d) => d.offset === 0) ?? ow.days[0];
    setupTimeSlider();
    tw.hidden = false;
    $('#last-measured').textContent = `Data terukur terakhir: ${fmtDay(ow.data_through)}`;
    const warn = $('#stale-warning');
    warn.hidden = !ow.stale;
    if (ow.stale) warn.replaceChildren(svgIcon('alert'), ' Data terukur terakhir lebih dari 7 hari lalu. Hari setelahnya adalah prakiraan Random Forest dan ketidakpastiannya lebih besar.');
  } catch {
    mode = 'legacy'; // ocean_window belum terbit: pakai grid bulanan
    tw.hidden = true;
  }
  await showVar(currentVar);
}

/* ---------- pinbox zona dan titik ---------- */
function zoneBox(p) {
  const rows = GROUPS.map((g) => h('div', { class: 'pinbox__row' },
    h('span', {}, g.label), h('span', { class: 'mono muted' }, `${fmt(p.msy[g.key])} / ${fmt(p.tac[g.key])}`), abundBadge(p.abundance[g.key])));
  const ecoBtn = h('button', { class: 'btn btn--ghost', 'aria-pressed': 'false', onclick: () => toggleEco(p.zone_id, ecoBtn) }, svgIcon('leaf'), 'Ekosistem');
  return h('section', { class: 'pinbox', 'aria-labelledby': 'zone-title' },
    h('p', { class: 'label' }, `Zona ${p.zone_id}`), h('h2', { id: 'zone-title' }, p.name),
    h('p', { class: 'muted', style: 'font-size:14px;margin:0' }, `${fmt(p.area_ha, 0)} ha, menempel garis pantai`),
    h('div', { class: 'pinbox__block' },
      h('div', { class: 'pinbox__row' }, h('span', {}, 'MSY'), h('span', { class: 'mono' }, `${fmt(p.msy.total)} ton/bulan`)),
      h('div', { class: 'pinbox__row' }, h('span', {}, 'TAC'), h('span', { class: 'mono' }, `${fmt(p.tac.total)} ton/bulan`)),
      h('p', { class: 'note' }, 'Nilai zona adalah alokasi dari MSY wilayah, bukan pengukuran.')),
    h('div', { class: 'pinbox__block' }, h('p', { class: 'label' }, 'Kelompok ikan: MSY / TAC (ton)'), rows,
      h('p', { class: 'note' }, 'Indeks berbasis aturan: kelas relatif, bukan jumlah ikan.')),
    h('div', { class: 'pinbox__block' }, h('span', { class: 'chip', title: p.season.note }, `Musim ${fmtMonth(p.month)}: ${p.season.label}`),
      h('div', { class: 'pinbox__actions' }, ecoBtn))
  );
}

function addDays(isoDate, n) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 10 hari dinamis untuk grafik pinbox: 7 hari terukur (H-6..H0) + 3 hari forecast (H+1..H+3)
function getPointDays() {
  const refDate = ow?.reference_date || currentDay?.date || '2026-11-18';
  const offsets = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3];
  return offsets.map((off) => {
    const dStr = addDays(refDate, off);
    return {
      date: dStr,
      label: `${dStr.slice(8, 10)}/${dStr.slice(5, 7)}`,
      kind: off <= 0 ? 'observed' : 'forecast'
    };
  });
}

let pointChartInstance = null;
function drawPointChart(seriesValues, vKey) {
  const canvas = document.getElementById('point-chart');
  if (!canvas || !window.Chart) return;
  if (pointChartInstance) {
    pointChartInstance.destroy();
    pointChartInstance = null;
  }
  const pointDays = getPointDays();
  const v = VARS[vKey] || { label: vKey, unit: '' };
  const obsData = seriesValues.map((val, idx) => (idx <= 6 ? val : null));
  const fcData = seriesValues.map((val, idx) => (idx >= 6 ? val : null));

  const sandColor = cssVar('--sand') || '#D3C3B9';
  const copperColor = cssVar('--copper') || '#B58863';
  const lineColor = cssVar('--line') || 'rgba(211, 195, 185, 0.18)';
  const textColor = cssVar('--text-muted') || '#A79E93';

  pointChartInstance = new window.Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: pointDays.map((d) => d.label),
      datasets: [
        {
          label: 'Terukur (7 Hari)',
          data: obsData,
          borderColor: sandColor,
          backgroundColor: sandColor,
          borderWidth: 2,
          pointRadius: 2.5,
          pointHoverRadius: 4,
          tension: 0.25
        },
        {
          label: 'Prakiraan (3 Hari)',
          data: fcData,
          borderColor: copperColor,
          backgroundColor: copperColor,
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 2.5,
          pointHoverRadius: 4,
          tension: 0.25
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: sandColor,
            font: { size: 10, family: 'IBM Plex Sans' },
            boxWidth: 12,
            padding: 6
          }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} ${v.unit}`
          }
        }
      },
      scales: {
        x: {
          grid: { color: lineColor },
          ticks: { color: textColor, font: { size: 9, family: 'IBM Plex Mono' } }
        },
        y: {
          grid: { color: lineColor },
          ticks: {
            color: textColor,
            font: { size: 9, family: 'IBM Plex Mono' },
            callback: (val) => Number(val).toFixed(2)
          }
        }
      }
    }
  });
}

async function fetchPointSeries(latlng, vKey) {
  const pointDays = getPointDays();
  const values = await Promise.all(
    pointDays.map(async (pd) => {
      try {
        const grid = await fetchDgrid(vKey, pd.date);
        let val = lookupValue(grid, latlng.lng, latlng.lat);
        if (vKey === 'current' && val == null && grid.uo && grid.vo) {
          const u = lookupValue({ ...grid, values: grid.uo }, latlng.lng, latlng.lat);
          const v = lookupValue({ ...grid, values: grid.vo }, latlng.lng, latlng.lat);
          val = speedAndDirection(u, v).speed;
        }
        return val != null ? Number(val.toFixed(3)) : null;
      } catch {
        return null;
      }
    })
  );
  return values;
}

function pointNotes(d) {
  const notes = [];
  if (mode === 'ocean' && d.day) {
    const k = kindOf(d.day);
    notes.push(`${fmtDay(d.day.date)}, ${k.sym} ${k.text}.`);
    if (d.day.kind === 'forecast') {
      const ms = metricFor('sst', d.day.horizon_days), mc = metricFor('chl', d.day.horizon_days), mu = metricFor('current', d.day.horizon_days);
      if (ms && mc && mu) notes.push(`Prakiraan Random Forest, RMSE uji horizon ${ms.horizon_days} hari (h+${d.day.horizon_days}): SST ${fmt(ms.rmse, 2)} °C, klorofil ${fmt(mc.rmse, 2)} mg/m³, arus ${fmt(mu.rmse, 2)} m/s.`);
    }
  }
  return notes;
}

function cancelPoint() {
  lastPoint = null;
  pinMarker?.remove();
  pinMarker = null;
  if (pointChartInstance) {
    pointChartInstance.destroy();
    pointChartInstance = null;
  }
  renderPanels(selected, null);
}

function pointBox(d) {
  const none = d.sst == null && d.chl == null && d.speed == null && d.depth == null;
  const header = h('div', { class: 'pinbox__header', style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--s2);' },
    h('span', { class: 'pinbox__coords', style: 'margin:0;' }, `${d.lat.toFixed(4)}, ${d.lng.toFixed(4)}`),
    h('button', {
      class: 'icon-btn',
      type: 'button',
      'aria-label': 'Tutup pinbox dan hapus pin',
      title: 'Tutup pin',
      style: 'width:24px;height:24px;padding:0;flex-shrink:0;',
      onclick: cancelPoint
    }, svgIcon('x'))
  );
  const out = [header];
  if (none) out.push(h('p', { class: 'note', role: 'status' }, 'Di luar jangkauan data atau di darat.'));
  else {
    out.push(
      h('div', { class: 'pinbox__row' }, h('span', {}, 'Kedalaman laut (Batimetri)'), h('span', { class: 'mono' }, d.depth != null ? `${fmt(d.depth, 1)} m` : '-')),
      h('div', { class: 'pinbox__row' }, h('span', {}, 'Klorofil-a'), h('span', { class: 'mono' }, `${fmt(d.chl, 2)} mg/m³`)),
      h('div', { class: 'pinbox__row' }, h('span', {}, 'SST'), h('span', { class: 'mono' }, `${fmt(d.sst)} °C`)),
      h('div', { class: 'pinbox__row' }, h('span', {}, 'Arus'),
        h('span', { class: 'mono' }, `${fmt(d.speed, 2)} m/s${d.direction_deg == null ? '' : `, ${dirLabel(d.direction_deg)}`}`))
    );
  }
  if (d.abundance) {
    out.push(h('div', { class: 'pinbox__block' }, GROUPS.map((g) => {
      let extra = '';
      if (g.key === 'demersal' && d.depth != null) {
        extra = d.depth >= 40 && d.depth <= 60 ? ' (40-60m)' : (d.depth < 40 ? ' (0-40m)' : ' (>60m)');
      }
      return h('div', { class: 'pinbox__row' }, h('span', {}, `${g.label}${extra}`), abundBadge(d.abundance[g.key]));
    }),
    h('p', { class: 'note' }, 'Kelimpahan demersal berbasis kedalaman: 40-60m (Sangat Berlimpah ▲), 0-40m (Berlimpah =), >60m (Kurang Berlimpah ▼).')));
  } else if (d.abundanceError) out.push(h('p', { class: 'note', role: 'status' }, d.abundanceError));
  if (d.series && d.series.some((v) => v != null)) {
    const v = VARS[currentVar];
    out.push(
      h('div', { class: 'pinbox__block' },
        h('p', { class: 'label', style: 'margin-bottom:var(--s1)' }, `${v.label} (7 Hari Terukur + 3 Hari Forecast)`),
        h('div', { style: 'height:150px;width:100%;position:relative;margin-top:var(--s2)' },
          h('canvas', { id: 'point-chart', role: 'img', 'aria-label': `Grafik tren ${v.label} 10 hari` })
        )
      )
    );
  }
  pointNotes(d).forEach((t) => out.push(h('p', { class: 'note' }, t)));
  return h('section', { class: 'pinbox', 'aria-label': 'Hasil titik' }, out);
}

function renderPanels(zone, point, pointSeries) {
  clear(panels);
  if (zone) panels.append(zoneBox(zone.properties));
  if (point) {
    panels.append(point);
    if (pointSeries) drawPointChart(pointSeries, currentVar);
  }
  if (zone && meta.is_fixture) panels.append(h('div', {}, fixtureChip()));
}

/* ---------- titik: nilai dihitung di klien dari grid hari terpilih (lookup, bukan model) ---------- */
async function gridValues(latlng) {
  const [sst, chl, cur, bathy] = await Promise.all([
    fetchDgrid('sst', currentDay.date),
    fetchDgrid('chl', currentDay.date),
    fetchDgrid('current', currentDay.date),
    fetchDgrid('bathymetry', currentDay.date)
  ]);
  const uo = lookupValue({ ...cur, values: cur.uo }, latlng.lng, latlng.lat);
  const vo = lookupValue({ ...cur, values: cur.vo }, latlng.lng, latlng.lat);
  const depth = lookupValue(bathy, latlng.lng, latlng.lat);
  return {
    sst: lookupValue(sst, latlng.lng, latlng.lat),
    chl: lookupValue(chl, latlng.lng, latlng.lat),
    depth: depth != null ? Number(depth.toFixed(1)) : null,
    ...speedAndDirection(uo, vo)
  };
}

function placePin(latlng) {
  pinMarker?.remove();
  pinMarker = L.marker(latlng, { pane: 'pin', icon: L.divIcon({ className: '', html: '<div class="pin-dot"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }), keyboard: false }).addTo(map);
}

async function handlePoint(latlng, inZone) {
  lastPoint = { latlng, inZone };
  placePin(latlng);
  await refreshPoint();
}

async function refreshPoint() {
  if (!lastPoint) return;
  const my = ++pointSeq;
  const { latlng, inZone } = lastPoint;
  try {
    const d = { lat: latlng.lat, lng: latlng.lng };
    if (mode === 'ocean') {
      const gVals = await gridValues(latlng);
      Object.assign(d, gVals, { day: currentDay });
      if (gVals.sst != null || gVals.chl != null || gVals.speed != null) {
        d.series = await fetchPointSeries(latlng, currentVar);
      }
    }
    if (inZone && selected) {
      try {
        if (!lastPoint.abund) {
          const a = await api(`/point?lat=${latlng.lat}&lng=${latlng.lng}&month=${meta.month}`);
          if (a.zone_id !== selected.properties.zone_id) throw new Error('Titik berada di zona lain. Lepas kunci untuk memilih zona itu.');
          lastPoint.abund = a;
        }
        d.abundance = lastPoint.abund.abundance;
        if (lastPoint.abund.depth != null) d.depth = lastPoint.abund.depth;
        if (mode !== 'ocean') Object.assign(d, { sst: lastPoint.abund.sst, chl: lastPoint.abund.chl, speed: lastPoint.abund.speed, direction_deg: lastPoint.abund.direction_deg, depth: lastPoint.abund.depth });
      } catch (e) { d.abundanceError = e.message; }
    }
    if (my !== pointSeq) return;
    renderPanels(selected, pointBox(d), d.series);
  } catch (e) {
    if (my === pointSeq) {
      renderPanels(selected, h('section', { class: 'pinbox', 'aria-label': 'Hasil titik' },
        h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--s2);' },
          h('span', { class: 'label' }, 'Galat Titik'),
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Tutup pinbox dan hapus pin', style: 'width:24px;height:24px;padding:0;flex-shrink:0;', onclick: cancelPoint }, svgIcon('x'))
        ),
        h('p', { class: 'note', role: 'status' }, e.message)
      ));
    }
  }
}

/* ---------- pilih / lepas zona ---------- */
function styleAll() { zoneLayers.forEach((ly, id) => ly.setStyle(zoneStyle(selected?.properties.zone_id === id, id))); }

function selectZone(f) {
  selected = f; locked = true; lastPoint = null;
  setCollapsed(true);
  toggleBtn.setAttribute('aria-disabled', 'true');
  $('#lockbar-label').textContent = `Zona ${f.properties.zone_id} terkunci`;
  lockbar.hidden = false;
  styleAll(); clearEco(); pinMarker?.remove(); pinMarker = null;
  renderPanels(f);
  map.flyToBounds(zoneLayers.get(f.properties.zone_id).getBounds(), { padding: [90, 90], maxZoom: 13, duration: 0.6, animate: !reducedMotion() });
}

function unlock() {
  selected = null; locked = false; lastPoint = null;
  lockbar.hidden = true; clearEco();
  pinMarker?.remove(); pinMarker = null;
  toggleBtn.removeAttribute('aria-disabled');
  setCollapsed(false); styleAll(); renderPanels(null);
  map.fitBounds(zoneLayer.getBounds(), { padding: [40, 40], animate: !reducedMotion() });
}
$('#lockbar-close').addEventListener('click', unlock);

async function toggleEco(zoneId, btn) {
  if (ecoLayer) { clearEco(); btn.setAttribute('aria-pressed', 'false'); return; }
  try {
    const eco = await api('/ecosystem');
    ecoLayer = L.geoJSON({ ...eco, features: eco.features.filter((f) => f.properties.zone_id === zoneId) }, {
      pane: 'eco',
      style: (f) => ({ color: cssVar(f.properties.type === 'coral' ? '--cur-2' : '--chl-2'), weight: 2, fillOpacity: 0.4, fillColor: cssVar(f.properties.type === 'coral' ? '--cur-2' : '--chl-2'), dashArray: f.properties.type === 'coral' ? null : '4 3' }),
      onEachFeature: (f, ly) => ly.bindTooltip(`${f.properties.type === 'coral' ? 'Terumbu karang' : 'Lamun'}: ${f.properties.name ?? ''}`, { sticky: true })
    }).addTo(map);
    btn.setAttribute('aria-pressed', 'true');
  } catch (e) { alert(e.message); }
}
function clearEco() { ecoLayer?.remove(); ecoLayer = null; panels.querySelectorAll('[aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', 'false')); }

/* ---------- inisialisasi ---------- */
async function init() {
  map = L.map('map', { zoomControl: false, center: [-6.2, 105.95], zoom: 9, minZoom: 8 });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  makePanes(map);
  await addBasemap(map);
  await addLand(map); // Daratan Indonesia putih solid langsung muncul otomatis di layer teratas

  try {
    const res = await Promise.allSettled([api('/meta'), api('/zones')]);
    if (res[0].status === 'fulfilled') meta = res[0].value;
    if (res[1].status === 'fulfilled') zonesFC = res[1].value;
  } catch (e) {
    console.error('Gagal memuat meta/zones:', e);
  }

  if (!zonesFC || !zonesFC.features || zonesFC.features.length === 0) {
    try {
      zonesFC = await api('/geo-zones');
    } catch (e) {
      console.error('Gagal memuat geo-zones fallback:', e);
    }
  }

  if (zonesFC && zonesFC.features) {
    zoneLayer = L.geoJSON(zonesFC, {
      pane: 'zones', style: (f) => zoneStyle(false, f.properties.zone_id),
      onEachFeature: (f, ly) => {
        zoneLayers.set(f.properties.zone_id, ly);
        ly.bindTooltip(`<b>${f.properties.zone_id}</b>: ${f.properties.name}`, { sticky: true, className: 'zone-label-badge' });
        ly.on({
          mouseover: () => {
            if (selected?.properties.zone_id !== f.properties.zone_id) {
              ly.setStyle({
                fillColor: '#00D2FF',
                fillOpacity: 0.55,
                weight: 4,
                color: '#38BDF8',
                dashArray: '10 7'
              });
            }
          },
          mouseout: () => ly.setStyle(zoneStyle(selected?.properties.zone_id === f.properties.zone_id, f.properties.zone_id)),
          click: (e) => {
            L.DomEvent.stopPropagation(e); // zona yang bisa dipilih tidak memicu klik peta biasa
            if (selected?.properties.zone_id === f.properties.zone_id) handlePoint(e.latlng, true);
            else selectZone(f);
          }
        });
      }
    });

    try {
      map.fitBounds(zoneLayer.getBounds(), { padding: [60, 60] });
    } catch {}
  }

  // Klik di mana saja pada area grid (di luar poligon zona) menaruh penanda titik.
  map.on('click', (e) => { if (mode === 'ocean') handlePoint(e.latlng, false); });
  await initTimeWindow();
  setCollapsed(false);
}

document.querySelectorAll('input[name="var"]').forEach((r) => r.addEventListener('change', () => {
  showVar(r.value);
  if (lastPoint) refreshPoint();
}));
$('#eco-btn').addEventListener('click', (e) => {
  ecoOn = !ecoOn;
  e.currentTarget.setAttribute('aria-pressed', String(ecoOn));
  if (ecoOn) {
    if (zoneLayer) {
      if (!map.hasLayer(zoneLayer)) zoneLayer.addTo(map);
      zoneLayer.bringToFront();
      try {
        map.fitBounds(zoneLayer.getBounds(), { padding: [50, 50], animate: !reducedMotion() });
      } catch {}
    }
  } else {
    if (locked) unlock();
    if (zoneLayer && map.hasLayer(zoneLayer)) zoneLayer.remove();
  }
});
init();