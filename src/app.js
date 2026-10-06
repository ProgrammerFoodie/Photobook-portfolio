import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ROOT, TRUST_PROXY, DIRS } from './config.js';
import { db } from './db.js';
import { securityHeaders } from './security.js';
import adminApi from './routes/admin-api.js';
import publicRoutes, { renderError } from './routes/public.js';

const PUBLIC_DIR = path.join(ROOT, 'public');

export function createApp() {
  // Housekeeping: leftovers from an interrupted run.
  for (const f of fs.readdirSync(DIRS.tmp)) fs.rmSync(path.join(DIRS.tmp, f), { force: true });
  db.prepare("UPDATE photos SET status = 'error', error = 'Interrupted by a restart. Upload it again.' WHERE status = 'processing'").run();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', TRUST_PROXY);
  app.use(securityHeaders);

  app.use('/admin/api', express.json({ limit: '100kb' }), adminApi);
  app.get('/admin', (req, res) => {
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex').sendFile(path.join(PUBLIC_DIR, 'admin.html'), { dotfiles: 'allow' });
  });

  // Static assets: URLs carry ?v=<build>, so they can be cached hard.
  app.use((req, res, next) => {
    res.locals.assetCache = req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache';
    next();
  });
  app.use(express.static(PUBLIC_DIR, {
    index: false, dotfiles: 'ignore', cacheControl: false,
    setHeaders: (res) => res.setHeader('Cache-Control', res.locals.assetCache),
  }));

  app.use(publicRoutes);

  app.use((req, res) => {
    if (req.path.startsWith('/admin/api') || req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
    renderError(req, res, 404, "We couldn't find that page.");
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
    const message = status === 413 ? 'File is too large (max 100 MB)'
      : status >= 500 ? 'Something went wrong' : err.message || 'Bad request';
    if (res.headersSent) return res.destroy();
    if (req.path.startsWith('/admin/api') || req.path.startsWith('/api')) return res.status(status).json({ error: message });
    renderError(req, res, status, status >= 500 ? 'Something went wrong on our side.' : message);
  });

  return app;
}
