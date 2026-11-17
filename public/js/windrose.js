const NS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

/** Mawar angin SVG 8 mata angin. deg = arah tujuan arus (0 = utara, searah jarum jam). */
export function windrose(deg, label) {
  const svg = mk('svg', { class: 'wr', viewBox: '-110 -110 220 220', role: 'img', 'aria-label': `Arah arus ${label}, ${Math.round(deg)} derajat` });
  svg.append(mk('circle', { class: 'wr-ring', r: 78 }), mk('circle', { class: 'wr-ring', r: 40 }));
  ['U', 'TL', 'T', 'TG', 'S', 'BD', 'B', 'BL'].forEach((t, i) => {
    const a = (i * 45 * Math.PI) / 180;
    svg.append(mk('line', { class: 'wr-tick', x1: Math.sin(a) * 72, y1: -Math.cos(a) * 72, x2: Math.sin(a) * 82, y2: -Math.cos(a) * 82 }));
    const lbl = mk('text', { class: 'wr-lbl', x: Math.sin(a) * 96, y: -Math.cos(a) * 96 });
    lbl.textContent = t;
    svg.append(lbl);
  });
  svg.append(mk('path', { class: 'wr-arrow', d: 'M0 -70 L8 -48 L2 -48 L2 30 L-2 30 L-2 -48 L-8 -48 Z', transform: `rotate(${deg})` }));
  return svg;
}
