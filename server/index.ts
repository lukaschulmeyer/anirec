import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAnimeApp } from './anime-http';
import { createMalService } from './mal-service';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const service = createMalService(process.env.MAL_CLIENT_ID?.trim());
const app = createAnimeApp(service);
const production = process.argv.includes('--production');
if (production) {
  app.use(express.static(path.join(root, 'dist'), { extensions: ['html'] }));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 4317);
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`AniRec ready at http://${host}:${port}`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  server.close(() => { void Promise.resolve(service.close?.()).finally(() => process.exit(0)); });
});
