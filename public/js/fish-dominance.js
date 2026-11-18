import { h } from './dom.js';
import { svgIcon } from './icons.js';

/**
 * Konfigurasi dominansi ikan per zona sesuai formula riset terrasea-stock:
 * Zona 1:
 *   pelagis besar = 1. tenggiri, 2. tongkol
 *   pelagis kecil = 1. kembung, 2. tembang
 *   demersal      = 1. kuniran, 2. peperek
 *
 * Zona 2:
 *   pelagis besar = 1. cakalang, 2. tuna
 *   pelagis kecil = 1. layang
 *   demersal      = 1. kapas-kapas, 2. kakap merah
 */
export const FISH_DOMINANCE_CONFIG = {
  1: {
    pelagis_besar: [
      { name: 'Tenggiri', image: '/img/foto_ikan/Ikan-Tenggiri.webp', rank: 1 },
      { name: 'Tongkol', image: '/img/foto_ikan/Ikan-Tongkol.webp', rank: 2 }
    ],
    pelagis_kecil: [
      { name: 'Kembung', image: '/img/foto_ikan/Ikan-Kembung.webp', rank: 1 },
      { name: 'Tembang', image: '/img/foto_ikan/Ikan-Tembang.webp', rank: 2 }
    ],
    demersal: [
      { name: 'Kuniran', image: '/img/foto_ikan/Ikan-Kuniran.webp', rank: 1 },
      { name: 'Peperek', image: '/img/foto_ikan/Ikan-Peperek.webp', rank: 2 }
    ]
  },
  2: {
    pelagis_besar: [
      { name: 'Cakalang', image: '/img/foto_ikan/Ikan-Cakalang.webp', rank: 1 },
      { name: 'Tuna', image: '/img/foto_ikan/Ikan-Tuna-Sirip-Kuning.webp', rank: 2 }
    ],
    pelagis_kecil: [
      { name: 'Layang', image: '/img/foto_ikan/Ikan-Layang.webp', rank: 1 }
    ],
    demersal: [
      { name: 'Kapas-kapas', image: '/img/foto_ikan/Ikan-Kapas-Kapas.webp', rank: 1 },
      { name: 'Kakap Merah', image: '/img/foto_ikan/Ikan-Kakap-Merah.webp', rank: 2 }
    ]
  }
};

const ABUND_META = {
  high: { sym: '▲', label: 'Sangat berlimpah', count: 2 },
  mid: { sym: '=', label: 'Berlimpah', count: 1 },
  low: { sym: '▼', label: 'Kurang berlimpah', count: 0 }
};

/**
 * Deteksi nomor zona (1 atau 2) dari zone_id atau nama zona.
 */
export function getZoneNumber(zoneId, zoneName = '') {
  const str = `${zoneId || ''} ${zoneName || ''}`.toLowerCase();
  if (str.includes('z-02') || str.includes('z-2') || str.includes('zona 2') || str.includes('lebak') || str.includes('bawah')) {
    return 2;
  }
  return 1;
}

/**
 * Menentukan status kelimpahan tiap kelompok pada titik.
 * Aturan kedalaman laut (batimetri) untuk demersal:
 * 40-60m = Sangat berlimpah (high)
 * 0-40m  = Berlimpah (mid)
 * >60m   = Kurang berlimpah (low)
 */
export function resolveAbundance(rawAbundance, depth = null) {
  const result = {
    pelagis_besar: rawAbundance?.pelagis_besar || 'mid',
    pelagis_kecil: rawAbundance?.pelagis_kecil || 'mid',
    demersal: rawAbundance?.demersal || 'mid'
  };

  if (depth != null) {
    if (depth >= 40 && depth <= 60) result.demersal = 'high';
    else if (depth < 40) result.demersal = 'mid';
    else result.demersal = 'low';
  }

  return result;
}

/**
 * Algoritma seleksi dominansi ikan:
 * 1. Urutan prioritas: pelagis besar > pelagis kecil > demersal
 * 2. Kelompok "sangat berlimpah" -> tunjukkan 2 jenis ikan
 * 3. Kelompok "berlimpah" -> tunjukkan 1 jenis ikan
 * 4. Kelompok "kurang berlimpah" -> 0 jenis ikan
 * 5. Batasi total hingga maksimal 4 jenis ikan
 */
export function computeDominantFish(zoneNum, abundanceByGroup, maxFish = 4) {
  const config = FISH_DOMINANCE_CONFIG[zoneNum] || FISH_DOMINANCE_CONFIG[1];
  const priorityOrder = ['pelagis_besar', 'pelagis_kecil', 'demersal'];
  const groupLabels = {
    pelagis_besar: 'Pelagis besar',
    pelagis_kecil: 'Pelagis kecil',
    demersal: 'Demersal'
  };

  const results = [];

  for (const groupKey of priorityOrder) {
    const abund = abundanceByGroup?.[groupKey] || 'low';
    const meta = ABUND_META[abund] || ABUND_META.low;
    const fishList = config[groupKey] || [];
    const countToShow = meta.count;

    const candidates = fishList.slice(0, countToShow);
    for (const fish of candidates) {
      results.push({
        ...fish,
        groupKey,
        groupLabel: groupLabels[groupKey],
        abundance: abund,
        abundanceSymbol: meta.sym,
        abundanceText: meta.label
      });
      if (results.length >= maxFish) break;
    }
    if (results.length >= maxFish) break;
  }

  return results.slice(0, maxFish);
}

/**
 * Komponen kartu ikan kecil untuk mini pin-body.
 */
function fishCard(fish) {
  const imgEl = h('img', {
    src: fish.image,
    alt: `Foto ikan ${fish.name}`,
    class: 'mini-fish-card__img',
    loading: 'lazy'
  });

  return h('article', { class: 'mini-fish-card' },
    h('div', { class: 'mini-fish-card__img-wrap' },
      imgEl
    ),
    h('div', { class: 'mini-fish-card__info' },
      h('h4', { class: 'mini-fish-card__name', title: fish.name }, fish.name),
      h('span', { class: 'mini-fish-card__group' }, fish.groupLabel)
    )
  );
}

/**
 * Render popover/overlay mini pin-body di atas peta.
 */
export function renderMiniPinBody({ zoneId, zoneName, latlng, dominantFish, onClose }) {
  const coordText = latlng ? `${Number(latlng.lat).toFixed(4)}, ${Number(latlng.lng).toFixed(4)}` : '';

  const header = h('div', { class: 'mini-pin-body__header' },
    h('div', { class: 'mini-pin-body__title-wrap' },
      h('span', { class: 'mini-pin-body__badge' }, zoneId || 'Zona'),
      h('h3', { class: 'mini-pin-body__title' }, 'Ikan Dominan')
    ),
    h('div', { style: 'display:flex;align-items:center;gap:var(--s2);' },
      coordText ? h('span', { class: 'mini-pin-body__coords' }, coordText) : null,
      onClose ? h('button', {
        class: 'icon-btn mini-pin-body__close',
        type: 'button',
        'aria-label': 'Tutup pin dan info dominansi ikan',
        title: 'Tutup pin',
        onclick: onClose
      }, svgIcon('x')) : null
    )
  );

  let content;
  if (!dominantFish || dominantFish.length === 0) {
    content = h('div', { class: 'mini-pin-body__empty' },
      h('p', { class: 'note', style: 'margin:0;' }, 'Tidak ada jenis ikan dominan pada status kelimpahan saat ini.')
    );
  } else {
    const gridClass = dominantFish.length === 1 ? 'mini-pin-grid mini-pin-grid--single' : 'mini-pin-grid';
    content = h('div', { class: gridClass }, dominantFish.map(fishCard));
  }

  const footer = h('div', { class: 'mini-pin-body__footer' },
    h('span', {}, `${dominantFish.length} jenis ikan dominan`),
    h('span', { style: 'font-family:var(--font-mono);' })
  );

  return h('div', { class: 'mini-pin-body', role: 'region', 'aria-label': 'Informasi dominansi ikan pada titik' },
    header,
    content,
    footer
  );
}

/**
 * Render blok dominansi ikan untuk disematkan di dalam pinbox panel sebelah kanan.
 */
export function renderFishDominanceBlock({ zoneId, dominantFish }) {
  if (!dominantFish || dominantFish.length === 0) {
    return h('div', { class: 'pinbox__block' },
      h('p', { class: 'label' }, 'Dominansi Ikan di Titik'),
      h('p', { class: 'note' }, 'Tidak ada jenis ikan dominan pada status kelimpahan saat ini.')
    );
  }

  const gridClass = dominantFish.length === 1 ? 'mini-pin-grid mini-pin-grid--single' : 'mini-pin-grid';
  return h('div', { class: 'pinbox__block' },
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--s2);' },
      h('p', { class: 'label', style: 'margin:0;' }, 'Spesies Ikan Dominan'),
      h('span', { class: 'chip chip--accent', style: 'font-size:11px;' }, zoneId || 'Zona')
    ),
    h('div', { class: gridClass }, dominantFish.map(fishCard)),
  );
}

