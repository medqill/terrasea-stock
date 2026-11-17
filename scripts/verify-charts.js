import puppeteer from 'puppeteer';
import { db } from '../src/db.js';
import crypto from 'node:crypto';

async function main() {
  // Buat sesi langsung di DB agar tidak terhalang rate limit
  const row = await db.execute({
    sql: "SELECT id, email, role FROM users WHERE email = 'admin2@gmail.com' LIMIT 1",
    args: []
  });
  const user = row.rows[0];
  const sid = crypto.randomBytes(24).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  await db.execute({
    sql: "INSERT INTO sessions (id, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
    args: [sid, user.id, now, now]
  });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  await page.setCookie({
    name: 'sid',
    value: sid,
    domain: 'localhost',
    path: '/',
    httpOnly: true
  });

  await page.goto('http://localhost:3000/stock-prediction', { waitUntil: 'networkidle2' });
  
  // Pilih zona Z-01
  await page.select('#zone-select', 'Z-01');
  await new Promise(r => setTimeout(r, 1200));

  await page.screenshot({ path: 'C:/Users/AQILL/.gemini/antigravity/brain/6f1e459d-a344-4275-99db-57b9b452ba54/stock_prediction_tac_z01.png', fullPage: true });

  // Pilih zona Z-02
  await page.select('#zone-select', 'Z-02');
  await new Promise(r => setTimeout(r, 1200));

  await page.screenshot({ path: 'C:/Users/AQILL/.gemini/antigravity/brain/6f1e459d-a344-4275-99db-57b9b452ba54/stock_prediction_tac_z02.png', fullPage: true });

  await browser.close();
  console.log('Screenshots captured successfully.');
}

main().catch(console.error);

