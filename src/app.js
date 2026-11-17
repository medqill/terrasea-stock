import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth, requireAdmin } from './middleware.js';
import authRoutes from './routes/auth.js';
import mapRoutes from './routes/map.js';
import stockRoutes from './routes/stock.js';
import downloadRoutes from './routes/download.js';
import adminRoutes from './routes/admin.js';
import ingestRoutes from './routes/ingest.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const views = path.join(root, 'views');

export function createApp() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET wajib diisi (min. 16 karakter) di produksi.');
    console.warn('[DEV] SESSION_SECRET kosong: memakai nilai sementara. Isi di .env.');
  }
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  app.use(helmet({
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Leaflet memberi atribut style pada elemen
        imgSrc: ["'self'", 'data:', 'blob:', 'https://api.maptiler.com', 'https://*.basemaps.cartocdn.com'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    }
  }));
  app.use(cookieParser(secret || 'dev-only-secret-ganti-di-env'));
  app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/api/ingest')) {
      return express.json({ limit: '10mb' })(req, res, next);
    }
    return express.json({ limit: '20kb' })(req, res, next);
  });

  // Hanya subfolder aset yang disajikan langsung dari public/ (tanpa cache di mode dev agar perubahan langsung tampak).
  for (const dir of ['css', 'js', 'vendor', 'img']) {
    app.use(`/${dir}`, express.static(path.join(pub, dir), {
      etag: false,
      maxAge: 0,
      setHeaders: (res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
      }
    }));
  }

  // Halaman HTML disajikan dari views/ (terisolasi dari static CDN).
  const page = (file) => (req, res) => res.sendFile(path.join(views, file));
  app.get('/', page('index.html'));
  app.get('/login', page('login.html'));
  app.get('/marine-stock', requireAuth, page('marine-stock.html'));
  app.get('/stock-prediction', requireAuth, page('stock-prediction.html'));
  app.get('/download', requireAuth, page('download.html'));
  app.get('/about', requireAuth, page('about.html'));
  app.get('/dashboard', requireAuth, requireAdmin, page('dashboard.html'));

  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/health', (req, res) => res.json({ status: 'online' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/ingest', ingestRoutes);
  app.use('/api/admin', requireAuth, requireAdmin, adminRoutes);
  app.use('/api', requireAuth, mapRoutes, stockRoutes, downloadRoutes);

  app.use((req, res) => {
    if (req.originalUrl.startsWith('/api')) return res.status(404).json({ message: 'Endpoint tidak ditemukan.' });
    res.status(404).type('text').send('Halaman tidak ditemukan.');
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err.message);
    res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
  });
  return app;
}
// Mengekspor aplikasi agar bisa dibaca oleh sistem Vercel
export default createApp();