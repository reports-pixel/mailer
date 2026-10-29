import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import app from './app.js';
import { config } from './config.js';
import { markInterrupted, migrate } from './db.js';
import { syncFromApi } from './employees.js';
import { verifyMail } from './mail.js';
import * as schedules from './scheduler.js';

// Windows server: serves the page, runs the daily schedules and keeps the user list in Turso up to date.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');

if (dev) {
  // Development: React with live reload from the same Node process; frames allowed to check phone/tablet widths.
  app.set('allowFrames', true);
  const { createServer } = await import('vite');
  app.use((await createServer({ root, server: { middlewareMode: true }, appType: 'spa' })).middlewares);
} else {
  app.use((req, res, next) => { res.set('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"); next(); });
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*page}', (req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}

await migrate();
await markInterrupted();
app.listen(config.port, config.host, () => console.log(`KG Mail Portal running at http://${config.host}:${config.port}/${dev ? ' (development)' : ''}`));
await verifyMail();

const sync = () => syncFromApi()
  .then(r => console.log(`[users] synced ${r.imported} users from the employee API`))
  .catch(error => console.error(`[users] sync failed: ${error.message}`));
if (config.employeeApiUrl) { sync(); setInterval(sync, 60 * 60000); }
setInterval(() => markInterrupted().catch(() => {}), 10 * 60000);
setTimeout(() => { schedules.tick(); setInterval(schedules.tick, 30000); }, 15000);
