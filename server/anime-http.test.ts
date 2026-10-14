import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createAnimeApp } from './anime-http';
import { CatalogError } from './catalog-error';
import type { CatalogService } from './anime-service';
import { fromMal } from './mal-service';

function fakeService(): CatalogService {
  return { mode: 'live', provider: 'mal', search: vi.fn(async () => []), titles: vi.fn(async () => []),
    featured: vi.fn(async () => []), candidates: vi.fn(async () => ({ titles: [] })),
    recommend: vi.fn(async ids => ({ items: [], seeds: [], seedIds: ids, note: null, candidateCount: 0, matchedCandidateCount: 0, catalogNote: null, signals: { sparse: false, conflicting: false } })) };
}

describe('public anime API boundary', () => {
  it('preserves requested release identity for show details and validates one MAL ID', async () => {
    const service = fakeService();
    service.series = vi.fn(async id => fromMal({ id: Number(id.slice(4)), title: 'Second installment' }));
    const app = createAnimeApp(service);
    const result = await request(app).get('/api/series?id=mal:2').expect(200);
    expect(result.body.title.id).toBe('mal:2');
    expect(service.series).toHaveBeenCalledWith('mal:2');
    for (const query of ['', '?id=mal:0', '?id=mal:1,mal:2', '?id=mal:1&id=mal:2', '?id=https://evil.invalid']) await request(app).get(`/api/series${query}`).expect(400);
    expect(service.series).toHaveBeenCalledTimes(1);
    const missing = fakeService();
    await request(createAnimeApp(missing)).get('/api/series?id=mal:2').expect(503);
  });
  it('returns ten-result page metadata and passes the validated offset to the provider', async () => {
    const service = fakeService();
    service.searchPage = vi.fn(async (_query: string, offset: number) => ({ titles: [], nextOffset: offset === 0 ? 10 : null }));
    const app = createAnimeApp(service);
    const first = await request(app).get('/api/search').query({ q: ' Naruto ' }).expect(200);
    expect(first.body).toEqual({ titles: [], nextOffset: 10, mode: 'live' });
    expect(service.searchPage).toHaveBeenLastCalledWith('Naruto', 0);
    const second = await request(app).get('/api/search').query({ q: 'Naruto', offset: '10' }).expect(200);
    expect(second.body.nextOffset).toBeNull();
    expect(service.searchPage).toHaveBeenLastCalledWith('Naruto', 10);
    expect(service.search).not.toHaveBeenCalled();
  });

  it('rejects malformed page offsets before provider calls and preserves legacy first-page search', async () => {
    const service = fakeService(); const app = createAnimeApp(service);
    for (const offset of ['-10', '1', '10.5', 'NaN', 'Infinity', '1e2', '01', '', '90071992547409920']) {
      await request(app).get('/api/search').query({ q: 'Naruto', offset }).expect(400);
    }
    await request(app).get('/api/search?q=Naruto&offset=0&offset=10').expect(400);
    expect(service.search).not.toHaveBeenCalled();
    const legacy = await request(app).get('/api/search?q=Naruto').expect(200);
    expect(legacy.body).toEqual({ titles: [], nextOffset: null, mode: 'live' });
    expect(service.search).toHaveBeenCalledWith('Naruto');
    await request(app).get('/api/search?q=Naruto&offset=10').expect(400);
    const short = await request(app).get('/api/search?q=a').expect(200);
    expect(short.body).toEqual({ titles: [], nextOffset: null, mode: 'live' });
  });

  it('enforces eight distinct MAL selections before provider work, consistently on restoration and recommendations', async () => {
    const service = fakeService(); const app = createAnimeApp(service);
    const ids = Array.from({ length: 8 }, (_, i) => `mal:${i + 1}`);
    await request(app).post('/api/recommend').send({ ids: [...ids, ids[0]] }).expect(200);
    expect(service.recommend).toHaveBeenLastCalledWith(ids, 'both');
    await request(app).get('/api/titles').query({ ids: ids.join(',') }).expect(200);
    for (const bad of [[...ids, 'mal:9'], ['movie:1'], ['mal:9007199254740992'], [null], [], ['mal:0']]) {
      await request(app).post('/api/recommend').send({ ids: bad }).expect(400);
      await request(app).get('/api/titles').query({ ids: bad.join(',') }).expect(400);
    }
    expect(service.recommend).toHaveBeenCalledTimes(1);
    expect(service.titles).toHaveBeenCalledTimes(1);
  });
  it('keeps restoration strict and sends candidate hydration through its partial method', async () => {
    const service = fakeService();
    service.hydrate = vi.fn(async () => ({ titles: [], unavailableIds: ['mal:4'] }));
    const app = createAnimeApp(service);
    const response = await request(app).get('/api/titles').query({ ids: 'mal:4', partial: '1' }).expect(200);
    expect(response.body.unavailableIds).toEqual(['mal:4']);
    expect(service.hydrate).toHaveBeenCalledWith(['mal:4']);
    expect(service.titles).not.toHaveBeenCalled();
    await request(app).get('/api/titles').query({ ids: 'mal:4', partial: 'oops' }).expect(400);
  });
  it('forwards safe retry guidance and rejects malformed searches, payloads, filters, and unknown API paths', async () => {
    const service = fakeService(); service.search = vi.fn(async () => { throw new CatalogError('Please try again shortly.', 429, 12); });
    const app = createAnimeApp(service);
    const busy = await request(app).get('/api/search?q=Naruto').expect(429);
    expect(busy.headers['retry-after']).toBe('12');
    expect(busy.headers['cache-control']).toBe('no-store');
    expect(busy.headers['x-powered-by']).toBeUndefined();
    await request(app).get('/api/search?q=a&q=b').expect(400);
    await request(app).get('/api/search').query({ q: 'x'.repeat(121) }).expect(400);
    await request(app).post('/api/recommend').send({ ids: ['mal:1'], type: 'everything' }).expect(400);
    await request(app).post('/api/recommend').set('Content-Type', 'application/json').send('{bad').expect(400);
    await request(app).post('/api/recommend').send({ ids: ['mal:1'], padding: 'x'.repeat(14000) }).expect(413);
    await request(app).get('/api/missing').expect(404);
  });
});
