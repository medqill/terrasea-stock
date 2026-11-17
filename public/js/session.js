// Pemantau idle sisi klien. Server tetap penentu: sesi kedaluwarsa 20 menit dicek di server.
import { api } from './api.js';
import { h } from './dom.js';

const IDLE = 20 * 60e3, WARN = 19 * 60e3, PING = 60e3;
let last = Date.now(), lastPing = Date.now(), dlg;

function warn() {
  if (dlg?.open) return;
  dlg = h('dialog', { 'aria-labelledby': 'idle-title' },
    h('h2', { id: 'idle-title', style: 'font-size:20px' }, 'Sesi hampir berakhir'),
    h('p', {}, 'Sesi akan berakhir dalam 1 menit karena tidak ada aktivitas.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn btn--primary', onclick: async () => {
      last = lastPing = Date.now();
      dlg.close();
      try { await api('/auth/me'); } catch { /* api() mengalihkan ke login bila perlu */ }
    } }, 'Tetap masuk')));
  document.body.append(dlg);
  dlg.showModal();
}

async function tick() {
  const idle = Date.now() - last;
  if (idle >= IDLE) { location.href = '/login?expired=1'; return; }
  if (idle >= WARN) { warn(); return; }
  if (last > lastPing && Date.now() - lastPing >= PING) {
    lastPing = Date.now();
    try { const m = await api('/auth/me'); if (!m.authenticated) location.href = '/login?expired=1'; } catch { /* abaikan */ }
  }
}

export function startIdleWatch() {
  for (const evt of ['pointerdown', 'keydown', 'scroll', 'touchstart']) addEventListener(evt, () => { if (!dlg?.open) last = Date.now(); }, { passive: true });
  setInterval(tick, 5000);
}
