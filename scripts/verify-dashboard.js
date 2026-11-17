import { db } from '../src/db.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

async function main() {
  // Tambahkan user pending contoh jika belum ada, untuk melihat tampilan umur tautan
  const existingPending = await db.one("SELECT id FROM users WHERE status='pending' LIMIT 1");
  if (!existingPending) {
    const now = Date.now();
    await db.tx([
      {
        sql: "INSERT INTO users (name, email, password_hash, salt, role, status, created_at) VALUES ('Budi Santoso', 'budi.santoso@kkp.go.id', 'dummy_hash', 'dummy_salt', 'user', 'pending', datetime('now', '-2 hours'))",
        args: []
      },
      {
        sql: "INSERT INTO email_tokens (token_hash, user_id, expires_at) VALUES ('hash_budi', last_insert_rowid(), ?)",
        args: [now + 22 * 3600 * 1000] // sisa 22 jam
      },
      {
        sql: "INSERT INTO users (name, email, password_hash, salt, role, status, created_at) VALUES ('Siti Rahma', 'siti.rahma@dinas.bantenprov.go.id', 'dummy_hash', 'dummy_salt', 'user', 'pending', datetime('now', '-30 hours'))",
        args: []
      },
      {
        sql: "INSERT INTO email_tokens (token_hash, user_id, expires_at) VALUES ('hash_siti', last_insert_rowid(), ?)",
        args: [now - 6 * 3600 * 1000] // kedaluwarsa 6 jam lalu
      }
    ]);
  }

  // Tambahkan beberapa contoh download_log jika baru sedikit
  const countDl = await db.one("SELECT COUNT(*) c FROM download_log");
  if (Number(countDl.c) < 3) {
    await db.run("INSERT INTO download_log (user_id, type, period_from, period_to, fish_group, created_at) VALUES (1, 'ocean', '2026-10', '2026-11', NULL, datetime('now', '-1 hours'))");
    await db.run("INSERT INTO download_log (user_id, type, period_from, period_to, fish_group, created_at) VALUES (2, 'catch', '2026-01', '2026-10', 'pelagis_kecil', datetime('now', '-3 hours'))");
    await db.run("INSERT INTO download_log (user_id, type, period_from, period_to, fish_group, created_at) VALUES (2, 'msy', '2026-01', '2026-11', 'pelagis_besar', datetime('now', '-5 hours'))");
  }

  // Ambil sesi admin2
  const adminRow = await db.one("SELECT id FROM users WHERE email='admin2@gmail.com'");
  const sid = 'verify_admin_sid_' + Date.now();
  const now = Date.now();
  await db.run("INSERT INTO sessions (id, user_id, created_at, last_activity) VALUES (?, ?, ?, ?)", [sid, adminRow.id, now, now]);

  console.log('Session inserted for admin2:', sid);

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const tmpProfile = 'C:\\Users\\AQILL\\AppData\\Local\\Temp\\chrome_test_profile_dashboard';
  fs.mkdirSync(tmpProfile, { recursive: true });

  const proc = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--window-size=1280,1600',
    '--remote-debugging-port=9223',
    `--user-data-dir=${tmpProfile}`,
    'about:blank'
  ]);

  await new Promise((r) => setTimeout(r, 1500));

  try {
    const listRes = await fetch('http://127.0.0.1:9223/json/list');
    const tabs = await listRes.json();
    const target = tabs.find((t) => t.type === 'page') || tabs[0];
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve) => ws.onopen = resolve);

    let msgId = 1;
    function send(method, params = {}) {
      const id = msgId++;
      return new Promise((resolve) => {
        const handler = (event) => {
          const res = JSON.parse(event.data);
          if (res.id === id) {
            ws.removeEventListener('message', handler);
            resolve(res.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    await send('Network.enable');
    await send('Page.enable');

    // Buat signed cookie sid
    // Untuk signed cookie express, cookie-parser menandai dengan s:sid.signature
    // Ambil signed cookie via login request
    const loginRes = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin2@gmail.com', password: 'admin' })
    });
    const setCookie = loginRes.headers.get('set-cookie');
    const cookieVal = setCookie.split(';')[0].split('=')[1];

    await send('Network.setCookie', {
      name: 'sid',
      value: cookieVal,
      domain: 'localhost',
      path: '/'
    });

    await send('Page.navigate', { url: 'http://localhost:3000/dashboard' });
    await new Promise((r) => setTimeout(r, 2500));

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync('C:/Users/AQILL/.gemini/antigravity/brain/6f1e459d-a344-4275-99db-57b9b452ba54/dashboard_admin_features.png', Buffer.from(shot.data, 'base64'));
    console.log('Screenshot saved to dashboard_admin_features.png');

    ws.close();
  } finally {
    proc.kill();
  }
}

main().catch(console.error);

