import './layout.js';
import { $, $$, h, reducedMotion } from './dom.js';
import { svgIcon } from './icons.js';

// Slide fitur di landing
const slides = $$('.slide');
const dots = h('div', { class: 'hero__dots', style: 'display:flex;gap:8px;margin-left:auto' });
let i = 0, timer;
const go = (n) => {
  i = (n + slides.length) % slides.length;
  slides.forEach((s, k) => { s.classList.toggle('is-active', k === i); s.setAttribute('aria-hidden', String(k !== i)); });
  [...dots.children].forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
};
slides.forEach((_, k) => dots.append(h('button', { class: 'hero__dot', 'aria-label': `Slide ${k + 1}`, onclick: () => { go(k); play(); } })));
const ctrl = $('.hero__ctrl');
ctrl.prepend(h('button', { class: 'hero__btn', 'aria-label': 'Slide sebelumnya', onclick: () => { go(i - 1); play(); } }, svgIcon('left')),
  h('button', { class: 'hero__btn', 'aria-label': 'Slide berikutnya', onclick: () => { go(i + 1); play(); } }, svgIcon('right')));
ctrl.append(dots);
function play() { clearInterval(timer); if (!reducedMotion()) timer = setInterval(() => go(i + 1), 8000); }
$('.hero').addEventListener('mouseenter', () => clearInterval(timer));
$('.hero').addEventListener('mouseleave', play);
$('.hero').addEventListener('focusin', () => clearInterval(timer));
go(0); play();

// Penanganan formulir kontak & aspirasi nelayan di landing
const contactForm = $('#contact-form');
if (contactForm) {
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const status = $('#contact-status');
    if (status) {
      status.textContent = 'Terima kasih. Pesan dan aspirasi Anda telah kami terima.';
      status.className = 'form-msg form-msg--ok';
    }
    contactForm.reset();
  });
}
