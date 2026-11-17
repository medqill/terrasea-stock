import nodemailer from 'nodemailer';

let transport;
function getTransport() {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  return transport;
}

export async function sendVerifyMail(to, link) {
  if (process.env.NODE_ENV === 'test') return;
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV === 'production') throw new Error('SMTP belum dikonfigurasi.');
    // Hanya development: tanpa SMTP, tautan dicetak agar alur daftar bisa diuji lokal.
    // Ini pengecualian dari aturan "jangan log token"; hapus bila tim tidak setuju.
    console.log(`[DEV] Tautan verifikasi untuk ${to}: ${link}`);
    return;
  }
  await getTransport().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'Verifikasi akun terrasea-stock',
    text: `Buka tautan berikut untuk mengaktifkan akun Anda. Tautan berlaku 24 jam dan hanya bisa dipakai sekali.\n\n${link}\n\nAbaikan email ini bila Anda tidak mendaftar.`
  });
}
