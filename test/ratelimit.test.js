import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createRateLimiter } from '../src/ratelimit.js';

test('ratelimit: melempar 429 saat batas terlampaui dan menyematkan header standar', async () => {
  const app = express();
  const testLimiter = createRateLimiter({
    prefix: 'test_limit',
    max: 3,
    windowDuration: '1 m',
    windowMs: 60 * 1000,
    message: 'Batas tercapai.'
  });

  app.get('/test-route', testLimiter, (req, res) => res.json({ ok: true }));

  const server = app.listen(0);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/test-route`;

  try {
    // 3 request pertama sukses
    for (let i = 1; i <= 3; i++) {
      const res = await fetch(url, {
        headers: { 'x-test-ratelimit': '1', 'x-forwarded-for': '192.168.1.100' }
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('ratelimit-limit'), '3');
      assert.equal(res.headers.get('ratelimit-remaining'), String(3 - i));
      assert.ok(res.headers.get('ratelimit-reset'));
    }

    // Request ke-4 harus 429 Too Many Requests
    const resBlocked = await fetch(url, {
      headers: { 'x-test-ratelimit': '1', 'x-forwarded-for': '192.168.1.100' }
    });
    assert.equal(resBlocked.status, 429);
    const body = await resBlocked.json();
    assert.equal(body.message, 'Batas tercapai.');

    // IP lain tetap diizinkan (per IP isolation)
    const resOtherIp = await fetch(url, {
      headers: { 'x-test-ratelimit': '1', 'x-forwarded-for': '192.168.1.200' }
    });
    assert.equal(resOtherIp.status, 200);
  } finally {
    server.close();
  }
});

test('ratelimit: mode fail-open jika limiter melempar galat', async () => {
  const app = express();
  const faultyLimiter = createRateLimiter({
    prefix: 'test_faulty',
    max: 2,
    windowDuration: '1 m',
    windowMs: 60 * 1000,
    message: 'Error limiter'
  });

  // Rusak memLimiter untuk mensimulasikan kegagalan jaringan atau crash provider
  faultyLimiter._memLimiter.limit = async () => {
    throw new Error('Simulasi koneksi Upstash Redis timeout/down');
  };

  app.get('/test-fail-open', faultyLimiter, (req, res) => res.json({ ok: true, failOpenSuccess: true }));

  const server = app.listen(0);
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}/test-fail-open`;

  try {
    // Meskipun limiter error, request tetap berhasil (fail-open)
    const res = await fetch(url, {
      headers: { 'x-test-ratelimit': '1' }
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.failOpenSuccess, true);
  } finally {
    server.close();
  }
});

