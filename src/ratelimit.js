// Rate limiting berbasis Upstash Redis (@upstash/ratelimit) dengan fail-open.
// Sesuai docs/ARCHITECTURE.md ADR 10 & Bagian 7.
// Bila Upstash Redis tidak dikonfigurasi atau tidak dapat dihubungi, request tetap
// diizinkan (fail-open) dan fallback ke in-memory sliding window lokal.
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const hasUpstash = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

let redis = null;
if (hasUpstash) {
  try {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN
    });
  } catch (err) {
    console.warn('[RATELIMIT] Gagal menginisialisasi Upstash Redis:', err.message);
  }
}

/**
 * Sliding window fallback berbasis memori lokal jika Upstash Redis tidak tersedia.
 */
class MemorySlidingWindow {
  constructor(windowMs, max) {
    this.windowMs = windowMs;
    this.max = max;
    this.hits = new Map();
  }

  async limit(id) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.hits.get(id) || []).filter((t) => t > windowStart);

    if (timestamps.length >= this.max) {
      this.hits.set(id, timestamps);
      return {
        success: false,
        limit: this.max,
        remaining: 0,
        reset: Math.ceil((timestamps[0] + this.windowMs) / 1000)
      };
    }

    timestamps.push(now);
    this.hits.set(id, timestamps);
    return {
      success: true,
      limit: this.max,
      remaining: this.max - timestamps.length,
      reset: Math.ceil((now + this.windowMs) / 1000)
    };
  }

  reset(id) {
    if (id) this.hits.delete(id);
    else this.hits.clear();
  }
}

/**
 * Pembuat middleware rate limiter dengan dukungan fail-open.
 */
export function createRateLimiter({
  prefix,
  max,
  windowDuration,
  windowMs,
  message,
  keyGenerator
}) {
  let upstashLimiter = null;
  if (redis) {
    try {
      upstashLimiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(max, windowDuration),
        prefix: `terrasea:${prefix}`,
        ephemeralCache: new Map()
      });
    } catch (err) {
      console.warn(`[RATELIMIT] Gagal membuat Upstash limiter ${prefix}:`, err.message);
    }
  }

  const memLimiter = new MemorySlidingWindow(windowMs, max);

  const middleware = async (req, res, next) => {
    // Lewati di lingkungan testing kecuali pengujian menyertakan header x-test-ratelimit
    if (process.env.NODE_ENV === 'test' && !req.headers['x-test-ratelimit']) {
      return next();
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || req.ip || '127.0.0.1';
    const identifier = keyGenerator ? keyGenerator(req) : ip;

    try {
      let result;
      if (upstashLimiter) {
        result = await upstashLimiter.limit(identifier);
      } else {
        result = await memLimiter.limit(identifier);
      }

      if (result) {
        res.setHeader('RateLimit-Limit', result.limit);
        res.setHeader('RateLimit-Remaining', result.remaining);
        res.setHeader('RateLimit-Reset', result.reset);

        if (!result.success) {
          return res.status(429).json({ message });
        }
      }
      next();
    } catch (err) {
      // Fail-open: kegagalan koneksi Upstash tidak boleh menghalangi request pengguna
      console.warn(`[RATELIMIT FAIL-OPEN] Terjadi kesalahan pada limiter "${prefix}": ${err.message}`);
      next();
    }
  };

  middleware._memLimiter = memLimiter;
  return middleware;
}

// 1. Login: 10 percobaan / 15 menit per IP
export const loginLimiter = createRateLimiter({
  prefix: 'login',
  max: 10,
  windowDuration: '15 m',
  windowMs: 15 * 60 * 1000,
  message: 'Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.'
});

// 2. Register: 5 percobaan / 1 jam per IP
export const registerLimiter = createRateLimiter({
  prefix: 'register',
  max: 5,
  windowDuration: '1 h',
  windowMs: 60 * 60 * 1000,
  message: 'Terlalu banyak pendaftaran dari alamat ini. Coba lagi nanti.'
});

// 3. Download: 20 unduhan / 10 menit per IP
export const downloadLimiter = createRateLimiter({
  prefix: 'download',
  max: 20,
  windowDuration: '10 m',
  windowMs: 10 * 60 * 1000,
  message: 'Terlalu banyak unduhan. Coba lagi dalam beberapa menit.'
});

// 4. Ingest IP Limiter: 120 req / 1 menit per IP
export const ingestIpLimiter = createRateLimiter({
  prefix: 'ingest_ip',
  max: 120,
  windowDuration: '1 m',
  windowMs: 60 * 1000,
  message: 'Batas frekuensi permintaan ingest per IP terlampaui. Coba lagi dalam 1 menit.'
});

// 5. Ingest Key Limiter: 60 req / 1 menit per API Key (untuk endpoint observasi rows)
export const ingestKeyLimiter = createRateLimiter({
  prefix: 'ingest_key',
  max: 60,
  windowDuration: '1 m',
  windowMs: 60 * 1000,
  keyGenerator: (req) => `key_${req.apiKey?.id || req.headers['x-forwarded-for'] || req.ip || 'anon'}`,
  message: 'Batas frekuensi permintaan ingest untuk kunci API ini terlampaui (maks. 60/menit).'
});

// 6. Artifact Key Limiter: 200 req / 1 menit per API Key (untuk PUT/DELETE artifacts dari pipeline ML)
export const artifactKeyLimiter = createRateLimiter({
  prefix: 'artifact_key',
  max: 200,
  windowDuration: '1 m',
  windowMs: 60 * 1000,
  keyGenerator: (req) => `artkey_${req.apiKey?.id || req.headers['x-forwarded-for'] || req.ip || 'anon'}`,
  message: 'Batas frekuensi permintaan artifact untuk kunci API ini terlampaui (maks. 200/menit).'
});

