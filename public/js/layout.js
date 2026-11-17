import { api } from './api.js';
import { h, $, $$ } from './dom.js';
import { svgIcon } from './icons.js';
import { startIdleWatch } from './session.js';
import { LIMITASI } from './labels.js';

const PAGES = [
  ['/', 'Beranda', 'landing'], ['/marine-stock', 'Marine Stock', 'marine-stock'], ['/stock-prediction', 'Stock Prediction', 'stock-prediction'],
  ['/download', 'Download Data', 'download'], ['/about', 'About', 'about']
];
const active = document.body.dataset.page;

function buildHeader(user) {
  const links = PAGES.map(([href, label, key]) => h('a', { href, 'aria-current': key === active ? 'page' : null }, label));
  if (user?.role === 'admin') links.push(h('a', { href: '/dashboard', 'aria-current': active === 'dashboard' ? 'page' : null }, 'Dashboard'));
  const nav = h('nav', { class: 'nav', id: 'main-nav', 'aria-label': 'Utama' }, links);
  const menuBtn = h('button', { class: 'menu-btn', 'aria-label': 'Buka menu', 'aria-expanded': 'false', 'aria-controls': 'main-nav',
    onclick: () => { const open = nav.classList.toggle('is-open'); menuBtn.setAttribute('aria-expanded', open); } }, svgIcon('menu'));
  const auth = user
    ? h('div', { class: 'auth' }, h('span', { class: 'auth__name' }, user.name),
        h('button', { class: 'btn btn--ghost', onclick: async () => { await api('/auth/logout', { method: 'POST' }).catch(() => {}); location.href = '/'; } }, svgIcon('logout'), 'Keluar'))
    : h('div', { class: 'auth' }, h('a', { class: 'btn btn--outline', href: '/login' }, 'Login'));
  return [
    h('a', { class: 'brand', href: '/', 'aria-label': 'terrasea-stock' },
      h('img', { class: 'brand__logo', src: '/img/logo.png', alt: 'terrasea-stock' })
    ),
    nav, auth, menuBtn
  ];
}

function buildFooter() {
  // Teks footer disalin persis dari kode sebelumnya (AGENTS: jangan ubah tanpa bertanya).
  return h('div', { class: 'container' },
    h('p', { class: 'label' }, 'Jump to feature'),
    h('ul', { class: 'footer-jump' }, PAGES.slice(1).map(([href, label]) => h('li', {}, h('a', { href }, label)))),
    h('div', { class: 'footer-base' },
      h('span', {}, '2026 Terrasea-Stock. All rights reserved. Maritime Data Systems.'),
      h('span', {}, 'Universitas Pendidikan Indonesia · Program Studi Sistem Informasi Kelautan')));
}

export function renderLimitations(into) {
  into.append(h('details', { class: 'note' }, h('summary', {}, 'Batasan data dan model'), h('ul', { class: 'plain-list' }, LIMITASI.map((t) => h('li', {}, t)))));
}

async function init() {
  let user = null;
  try { const me = await api('/auth/me'); user = me.authenticated ? me.user : null; } catch { /* anonim */ }
  const header = $('#site-header'); if (header) header.replaceChildren(...buildHeader(user));
  const footer = $('#site-footer'); if (footer) footer.replaceChildren(buildFooter());
  $$('[data-icon]').forEach((el) => el.prepend(svgIcon(el.dataset.icon)));
  if (user) startIdleWatch();
  document.dispatchEvent(new CustomEvent('layout:ready', { detail: { user } }));
}
init();
