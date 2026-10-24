// Airport Retail Media Platform — server entrypoint.
// Seeds the embedded SQLite store, starts the simulation engine, mounts the
// REST API + SSE, and (in production) serves the built frontend statically.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { store } from './db.js';
import { seedAll } from './seed/seed.js';
import { startSim, runDecisions } from './sim.js';
import api from './routes/api.js';

if (!store.kvGet('seeded', false)) { seedAll(store); console.log('[seed] deterministic seed applied'); }
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api', api);
app.get('/health', (req, res) => res.json({ ok: true }));

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => { if (req.path.startsWith('/api')) return next(); res.sendFile(path.join(dist, 'index.html')); });
} else {
  app.get('/', (req, res) => res.send('API running. Frontend not built yet — run `npm --prefix web run build` or use the Vite dev server.'));
}
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`[server] listening on :${PORT}`));
startSim(store);
runDecisions(store, 0); // prime now-playing for every screen
