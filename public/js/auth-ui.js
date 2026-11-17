import './layout.js';
import { api } from './api.js';
import { $ } from './dom.js';

const params = new URLSearchParams(location.search);
const note = $('#top-msg');
const MSG = {
  expired: ['Sesi berakhir karena tidak ada aktivitas selama 20 menit. Masuk kembali untuk melanjutkan.', 'error'],
  'verify=ok': ['Email terverifikasi. Silakan masuk.', 'ok'],
  'verify=gagal': ['Tautan verifikasi tidak valid, sudah dipakai, atau kedaluwarsa (24 jam). Daftar ulang untuk mendapat tautan baru.', 'error']
};
const key = params.has('expired') ? 'expired' : params.get('verify') ? `verify=${params.get('verify')}` : null;
if (key && MSG[key]) { note.textContent = MSG[key][0]; note.className = `form-msg form-msg--${MSG[key][1]}`; }

const show = (which) => { $('#login-panel').hidden = which !== 'login'; $('#register-panel').hidden = which !== 'register'; };
$('#to-register').addEventListener('click', () => show('register'));
$('#to-login').addEventListener('click', () => show('login'));

function bind(formId, msgId, path, onOk) {
  $(formId).addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $(msgId), btn = e.submitter;
    const body = Object.fromEntries(new FormData(e.target));
    btn.disabled = true; msg.className = 'form-msg'; msg.textContent = 'Memproses...';
    try { onOk(await api(path, { method: 'POST', body }), msg); }
    catch (err) { msg.className = 'form-msg form-msg--error'; msg.textContent = err.message; }
    finally { btn.disabled = false; }
  });
}
bind('#login-form', '#login-msg', '/auth/login', () => { location.href = '/marine-stock'; });
bind('#register-form', '#register-msg', '/auth/register', (res, msg) => { msg.className = 'form-msg form-msg--ok'; msg.textContent = res.message; $('#register-form').reset(); });
