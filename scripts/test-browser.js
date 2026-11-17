import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

async function check() {
  const loginData = JSON.stringify({ email: 'admin2@gmail.com', password: 'admin' });
  const rawCookie = await new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(loginData)
      }
    }, (res) => {
      const h = res.headers['set-cookie']?.[0];
      resolve(h?.split(';')[0]);
    });
    req.write(loginData);
    req.end();
  });

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const tmpProfile = 'C:\\Users\\AQILL\\AppData\\Local\\Temp\\chrome_test_profile_stock_full';
  fs.mkdirSync(tmpProfile, { recursive: true });

  const proc = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--window-size=1280,1200',
    '--remote-debugging-port=9222',
    `--user-data-dir=${tmpProfile}`,
    'about:blank'
  ]);

  await new Promise((r) => setTimeout(r, 1500));

  try {
    const listRes = await fetch('http://127.0.0.1:9222/json/list');
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

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Network.enable');

    if (rawCookie) {
      const [cName, cVal] = rawCookie.split('=');
      await send('Network.setCookie', {
        name: cName,
        value: decodeURIComponent(cVal),
        domain: 'localhost',
        path: '/'
      });
    }

    await send('Page.navigate', { url: 'http://localhost:3000/stock-prediction' });
    await new Promise((r) => setTimeout(r, 3000));

    // Pilih zona Z-02
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const sel = document.querySelector('#zone-select');
          if (sel) {
            sel.value = 'Z-02';
            sel.dispatchEvent(new Event('change'));
          }
        })()
      `
    });

    await new Promise((r) => setTimeout(r, 2000));

    // Ambil screenshot
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot?.data) {
      fs.writeFileSync('C:\\Users\\AQILL\\.gemini\\antigravity\\brain\\6f1e459d-a344-4275-99db-57b9b452ba54\\stock_prediction_2_forecasts_full.png', Buffer.from(shot.data, 'base64'));
      console.log('Saved screenshot stock_prediction_2_forecasts_full.png');
    }

  } finally {
    proc.kill();
  }
}

check();
