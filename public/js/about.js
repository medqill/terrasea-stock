import './layout.js';
import { $$, h } from './dom.js';

// Bila foto belum diunggah, tampilkan inisial agar kartu tetap rapi.
$$('.member__photo').forEach((img) => img.addEventListener('error', () => img.replaceWith(h('div', { class: 'member__fallback', 'aria-hidden': 'true' }, img.dataset.initial)), { once: true }));
