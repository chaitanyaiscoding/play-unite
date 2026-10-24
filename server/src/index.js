import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { connectDb, disconnectDb } from './db.js';
import authRouter from './routes/auth.js';
import playersRouter from './routes/players.js';
import teamsRouter from './routes/teams.js';
import requestsRouter from './routes/requests.js';
import notificationsRouter from './routes/notifications.js';
import { Team } from './models/Team.js';
import { API_VERSION } from '../../shared/version.js';
import matchesRouter from './routes/matches.js';

const PORT = Number(process.env.PORT) || 5000;
const PRODUCTION = process.env.NODE_ENV === 'production';
const app = express();

// Behind a reverse proxy (Caddy in docker-compose): trust its X-Forwarded-*
// headers so req.secure is true over HTTPS and session cookies get `Secure`.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
app.disable('x-powered-by');

// In production the client is served from this same origin, so no CORS.
if (!PRODUCTION) app.use(cors());
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, apiVersion: API_VERSION }));
app.use('/api/auth', authRouter);
app.use('/api/players', playersRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/matches', matchesRouter);
// Unknown API routes answer in JSON, not Express's HTML page.
app.use('/api', (req, res) => res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}.` }));

// Serve the built client in production (npm run build && npm start)
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

await connectDb();
// Teams marked as playing without a match (from before matches were tracked) are free.
await Team.updateMany({ inMatch: true, currentMatch: null }, { inMatch: false, matchStartedAt: null });
const server = app.listen(PORT, () => console.log(`[api] http://localhost:${PORT}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close();
    await disconnectDb();
    process.exit(0);
  });
}
