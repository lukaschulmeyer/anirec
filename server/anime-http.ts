import express from 'express';
import type { OutputType } from '../src/shared/types';
import type { CatalogService } from './anime-service';
import { CatalogError } from './catalog-error';

const MAX_PICKS = 8;
function selection(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 64 || value.some(id => typeof id !== 'string' || !/^mal:[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id.slice(4))))) {
    throw new CatalogError('Choose anime titles from the search results.', 400);
  }
  const ids = [...new Set(value)] as string[];
  if (!ids.length || ids.length > MAX_PICKS) throw new CatalogError('Choose between one and eight anime titles.', 400);
  return ids;
}

/** The anime-only production boundary deliberately has no legacy catalog imports. */
export function createAnimeApp(service: CatalogService) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '12kb', strict: true }));
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.get('/api/status', (_req, res) => {
    res.json({ mode: service.mode, provider: 'MyAnimeList', configured: service.configured?.() ?? false,
      label: 'Anime · MyAnimeList', connection: service.connection?.() ?? 'unavailable' });
  });
  app.get('/api/featured', async (_req, res, next) => {
    try { res.json({ titles: await service.featured() }); } catch (error) { next(error); }
  });
  app.get('/api/search', async (req, res, next) => {
    try {
      if (req.query.q !== undefined && typeof req.query.q !== 'string') throw new CatalogError('Enter an anime title.', 400);
      const rawOffset = req.query.offset ?? '0';
      if (typeof rawOffset !== 'string' || !/^(0|[1-9]\d*)$/.test(rawOffset)) throw new CatalogError('Choose a valid search results page.', 400);
      const offset = Number(rawOffset);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset % 10 !== 0) throw new CatalogError('Choose a valid search results page.', 400);
      const query = ((req.query.q as string | undefined) ?? '').trim();
      if (query.length > 120) throw new CatalogError('Please use a shorter title search.', 400);
      if (offset > 0 && !service.searchPage) throw new CatalogError('More search results are unavailable for this catalog.', 400);
      const page = query.length < 2 ? { titles: [], nextOffset: null }
        : service.searchPage ? await service.searchPage(query, offset)
          : { titles: await service.search(query), nextOffset: null };
      res.json({ ...page, mode: service.mode });
    } catch (error) { next(error); }
  });
  app.get('/api/titles', async (req, res, next) => {
    try {
      const ids = selection(typeof req.query.ids === 'string' ? req.query.ids.split(',') : null);
      if (req.query.partial !== undefined && req.query.partial !== '1') throw new CatalogError('That detail request is not valid.', 400);
      if (req.query.partial === '1' && service.hydrate) {
        res.json({ ...await service.hydrate(ids), mode: service.mode });
      } else {
        res.json({ titles: await service.titles(ids), mode: service.mode });
      }
    } catch (error) { next(error); }
  });
  app.get('/api/series', async (req, res, next) => {
    try {
      const [id] = selection(typeof req.query.id === 'string' ? [req.query.id] : null);
      if (!service.series) throw new CatalogError('Show details are temporarily unavailable. Please try again.', 503);
      res.json({ title: await service.series(id) });
    } catch (error) { next(error); }
  });
  app.post('/api/recommend', async (req, res, next) => {
    try {
      const ids = selection(req.body?.ids);
      const type = (req.body?.type ?? 'both') as OutputType;
      if (!['both', 'movie', 'tv'].includes(type)) throw new CatalogError('Choose All anime, Series, or Movies.', 400);
      if (!service.recommend) throw new CatalogError('Recommendations are temporarily unavailable. Please try again.');
      res.json({ ...await service.recommend(ids, type), mode: service.mode });
    } catch (error) { next(error); }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'That request could not be found.' }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    if (error instanceof CatalogError) {
      if (error.retryAfterSeconds && Number.isFinite(error.retryAfterSeconds)) res.setHeader('Retry-After', String(Math.max(1, Math.ceil(error.retryAfterSeconds))));
      res.status(error.status).json({ error: error.message });
    } else if (error instanceof SyntaxError) {
      res.status(400).json({ error: 'The request could not be read. Please try again.' });
    } else if (typeof error === 'object' && error && 'type' in error && error.type === 'entity.too.large') {
      res.status(413).json({ error: 'That request is too large.' });
    } else {
      console.error('AniRec request failed:', error instanceof Error ? error.name : 'Unknown error');
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });
  return app;
}
