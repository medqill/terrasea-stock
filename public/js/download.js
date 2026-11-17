import './layout.js';
import { api } from './api.js';
import { $, cssVar } from './dom.js';
import { VARS, makePanes, addBasemap, addLand, gridOverlay, zoneStyle } from './mapkit.js';

const form = $('#dl-form'), status = $('#dl-status'), typeSel = $('#dl-type');
let map, gridLayer, meta;

const shift = (ym, d) => { const [y, m] = ym.split('-').map(Number); const t = new Date(y, m - 1 + d, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; };
const say = (msg, kind = '') => { status.textContent = msg; status.className = `form-msg ${kind ? `form-msg--${kind}` : ''}`; };

typeSel.addEventListener('change', () => { $('#group-field').hidden = typeSel.value !== 'msy'; showGrid(); });

async function showGrid() {
  gridLayer?.remove(); gridLayer = null;
  const v = typeSel.value;
  if (!VARS[v] || !meta) return;
  try { gridLayer = gridOverlay(await api(`/grids/${v}?month=${meta.month}`), v).addTo(map); } catch { /* minimap tetap tampil tanpa grid */ }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = new URLSearchParams({ type: typeSel.value, from: $('#dl-from').value, to: $('#dl-to').value });
  if (typeSel.value === 'msy') q.set('group', $('#dl-group').value);
  say('Menyiapkan berkas...');
  try {
    const res = await fetch(`/api/download?${q}`, { credentials: 'same-origin' });
    if (res.status === 401) { location.href = '/login?expired=1'; return; }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `Galat ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: (res.headers.get('Content-Disposition') || '').match(/filename="(.+)"/)?.[1] || 'terrasea-stock.xlsx' });
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    say('Berkas diunduh. Sheet Metadata memuat sumber, versi model, dan limitasi.', 'ok');
  } catch (err) { say(err.message, 'error'); }
});

(async () => {
  map = L.map('minimap', { center: [-6.2, 105.95], zoom: 9, zoomControl: false, attributionControl: true });
  makePanes(map, false);
  await addBasemap(map);
  try {
    const [m, zones] = await Promise.all([api('/meta'), api('/zones')]);
    meta = m;
    $('#dl-to').value = m.month; $('#dl-from').value = shift(m.month, -10);
    const zl = L.geoJSON(zones, { pane: 'zones', style: () => zoneStyle(false), interactive: false }).addTo(map);
    map.fitBounds(zl.getBounds(), { padding: [20, 20] });
    await addLand(map);
    await showGrid();
  } catch (err) { say(err.message, 'error'); }
})();
