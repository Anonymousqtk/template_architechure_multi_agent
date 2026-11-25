import { Pool } from 'pg';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
const app = createApp({ pool, config });
const frontendRoot = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
app.use(express.static(frontendRoot, { index: false }));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
  res.sendFile('index.html', { root: frontendRoot });
});
const server = app.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => {
  console.info(
    `ManagerHR listening; email delivery: ${process.env.SMTP_HOST ? 'SMTP configured (delivery requires verification)' : 'DEV_ONLY — no email sent'}`,
  );
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.close(() => {
      void pool.end();
    });
  });
