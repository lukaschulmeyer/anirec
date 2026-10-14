import { describe, expect, it, vi } from 'vitest';
import { createMalService, fromMal } from './mal-service';

const row = (id: number, extra: Record<string, unknown> = {}) => ({ id, title: `Anime ${id}`, related_anime: [], ...extra });
const edge = (id: number, count: number, extra: Record<string, unknown> = {}) => ({ node: row(id, extra), num_recommendations: count });
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const fake = (handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) => vi.fn(async (url: string | URL | Request, init?: RequestInit) => handler(new URL(String(url)), init)) as unknown as typeof fetch;
const complete = (id: number, extra: Record<string, unknown> = {}) => row(id, {
  main_picture: null, alternative_titles: { en: '', ja: '', synonyms: [] }, start_date: null, end_date: null, synopsis: null,
  mean: null, num_scoring_users: 0, nsfw: 'white', genres: [], media_type: 'tv', status: 'finished_airing', num_episodes: 12,
  start_season: null, source: 'original', average_episode_duration: 1440, rating: 'pg_13', studios: [], ...extra,
});

describe('MAL metadata mapping', () => {
  it('maps provider display fields and keeps ratings separate from ranking', () => {
    const title = fromMal(row(1, {
      main_picture: { medium: 'https://cdn.myanimelist.net/images/anime/small.jpg', large: 'https://cdn.myanimelist.net/images/anime/large.jpg' },
      alternative_titles: { en: 'English title', ja: '日本語', synonyms: ['Alias', 'Alias'] },
      start_date: '2001-04-03', end_date: '2001-09-25', synopsis: 'A factual summary.', mean: 8.5, num_scoring_users: 100,
      genres: [{ id: 1, name: 'Action' }], media_type: 'tv', status: 'finished_airing', num_episodes: 26,
      start_season: { year: 2001, season: 'spring' }, source: 'manga', average_episode_duration: 1440, rating: 'pg_13', studios: [{ id: 1, name: 'Studio' }],
    }), true);
    expect(title).toMatchObject({ id: 'mal:1', year: 2001, runtime: 24, overview: 'A factual summary.', genres: ['Action'], traits: {} });
    expect(title.posterPreviewUrl).toContain('small.jpg');
    expect(title.posterUrl).toContain('large.jpg');
    expect(title.anime).toEqual({ format: 'tv', englishTitle: 'English title', japaneseTitle: '日本語', synonyms: ['Alias'], startDate: '2001-04-03', endDate: '2001-09-25', status: 'finished_airing', episodes: 26, episodeMinutes: 24, studios: ['Studio'], communityScore: 8.5, scoringUsers: 100, ageRating: 'pg_13', sourceMaterial: 'manga', season: 'spring 2001', detailsLoaded: true });
  });

  it('does not invent missing details or accept unsafe poster links', () => {
    const title = fromMal(row(2, { num_episodes: 0, average_episode_duration: 0, mean: '9', main_picture: { medium: 'javascript:alert(1)', large: 'https://attacker.example/poster.jpg' } }));
    expect(title).toMatchObject({ year: null, posterUrl: null, overview: '', genres: [], anime: { format: 'unknown', episodes: null, episodeMinutes: null, communityScore: null, detailsLoaded: false } });
  });

  it('accepts the legacy artwork host documented by MAL', () => {
    expect(fromMal(row(1, { main_picture: { medium: 'https://myanimelist.cdn-dena.com/images/anime/5/19644.jpg' } })).posterUrl).toBe('https://myanimelist.cdn-dena.com/images/anime/5/19644.jpg');
  });
});

describe('MAL API service', () => {
  it('shows setup state without fabricating a sample catalog', async () => {
    const fetcher = fake(() => response({}));
    const service = createMalService(undefined, fetcher);
    expect(service.provider).toBe('mal');
    expect(service.configured?.()).toBe(false);
    expect(service.connection?.()).toBe('unavailable');
    expect(await service.featured()).toEqual([]);
    await expect(service.search('cowboy')).rejects.toMatchObject({ status: 503, message: expect.stringContaining('not connected') });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps the client ID in the server header and requests useful fields', async () => {
    const fetcher = fake((url, init) => {
      expect(url.origin).toBe('https://api.myanimelist.net');
      expect(url.pathname).toBe('/v2/anime');
      expect(url.searchParams.get('q')).toBe('cowboy');
      expect(url.searchParams.get('limit')).toBe('10');
      expect(url.searchParams.get('nsfw')).toBe('false');
      expect(url.searchParams.get('fields')).toContain('synopsis');
      expect(new Headers(init?.headers).get('X-MAL-CLIENT-ID')).toBe('test-client-id');
      expect(url.toString()).not.toContain('test-client-id');
      return response({ data: [{ node: row(1, { synopsis: 'Summary', media_type: 'tv' }) }] });
    });
    const service = createMalService('test-client-id', fetcher);
    const found = await service.search(' cowboy ');
    expect(found[0].overview).toBe('Summary');
    expect(service.connection?.()).toBe('verified');
    expect(JSON.stringify(found)).not.toContain('test-client-id');
  });

  it('deduplicates concurrent requests and caches recent responses', async () => {
    const fetcher = fake(async () => { await new Promise(resolve => setTimeout(resolve, 5)); return response({ data: [{ node: row(1) }] }); });
    const service = createMalService('id', fetcher);
    await Promise.all([service.search('same'), service.search('same')]);
    await service.search('same');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('prioritizes the exact title above related editions while preserving other MAL ordering', async () => {
    const fetcher = fake(() => response({ data: [
      { node: row(5, { title: 'Cowboy Bebop: Tengoku no Tobira', media_type: 'movie' }) },
      { node: row(4037, { title: 'Cowboy Bebop: Yose Atsume Blues' }) },
      { node: row(1, { title: 'Cowboy Bebop', media_type: 'tv' }) },
      { node: row(17205, { title: 'Cowboy Bebop: Ein no Natsuyasumi' }) },
    ] }));
    const titles = await createMalService('id', fetcher).search('  COWBOY   BEBOP  ');
    expect(titles.map(title => title.id)).toEqual(['mal:1', 'mal:5', 'mal:4037', 'mal:17205']);
  });

  it('also prioritizes an exact English title and leaves partial searches in MAL order', async () => {
    const fetcher = fake(() => response({ data: [
      { node: row(20, { title: 'Spirited Away: A Related Title' }) },
      { node: row(199, { title: 'Sen to Chihiro no Kamikakushi', alternative_titles: { en: 'Spirited Away' } }) },
      { node: row(30, { title: 'Spirited Tales' }) },
    ] }));
    const service = createMalService('id', fetcher);
    expect((await service.search('Spirited Away')).map(title => title.id)).toEqual(['mal:199', 'mal:20', 'mal:30']);
    expect((await service.search('Spirited')).map(title => title.id)).toEqual(['mal:20', 'mal:199', 'mal:30']);
  });

  it('loads only the requested search page, keeps page caches separate, and follows provider pagination metadata', async () => {
    const fetcher = fake(url => {
      const offset = Number(url.searchParams.get('offset'));
      expect(url.searchParams.get('limit')).toBe('10');
      expect(url.searchParams.get('q')).toBe('Cowboy Bebop');
      const data = Array.from({ length: 10 }, (_, index) => ({ node: row(offset + index + 1) }));
      return response({ data, paging: offset === 0 ? { next: 'https://api.myanimelist.net/v2/anime?q=Cowboy%20Bebop&offset=10&limit=10' } : {} });
    });
    const service = createMalService('id', fetcher);
    const first = await service.searchPage!('  Cowboy   Bebop  ', 0);
    expect(first.titles).toHaveLength(10);
    expect(first.nextOffset).toBe(10);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const second = await service.searchPage!('Cowboy Bebop', 10);
    expect(second.titles.map(title => title.id)).toEqual(Array.from({ length: 10 }, (_, index) => `mal:${index + 11}`));
    expect(second.nextOffset).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await service.search('Cowboy Bebop')).toEqual(first.titles);
    expect(await service.searchPage!('Cowboy Bebop', 10)).toEqual(second);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses the actual next offset even when a returned page has fewer than ten titles', async () => {
    const fetcher = fake(() => response({ data: [{ node: row(1) }], paging: { next: 'https://api.myanimelist.net/v2/anime?offset=20&limit=10' } }));
    const page = await createMalService('id', fetcher).searchPage!('anime', 0);
    expect(page.titles).toHaveLength(1);
    expect(page.nextOffset).toBe(20);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not infer another page from ten results or an exact-title match', async () => {
    const fetcher = fake(() => response({ data: Array.from({ length: 10 }, (_, index) => ({ node: row(index + 1, { title: index === 9 ? 'Anime' : `Anime special ${index}` }) })) }));
    const page = await createMalService('id', fetcher).searchPage!('anime', 10);
    expect(page.nextOffset).toBeNull();
    expect(page.titles.map(title => title.id)).toEqual(['mal:10', 'mal:1', 'mal:2', 'mal:3', 'mal:4', 'mal:5', 'mal:6', 'mal:7', 'mal:8', 'mal:9']);
  });

  it.each([-10, 1, 10.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid search offset %s before contacting MAL', async offset => {
    const fetcher = fake(() => response({ data: [] }));
    await expect(createMalService('id', fetcher).searchPage!('anime', offset)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    'https://attacker.example/v2/anime?q=anime&offset=10&limit=10',
    'https://api.myanimelist.net/v2/users?q=anime&offset=10&limit=10',
    'https://api.myanimelist.net/v2/anime?q=different&offset=10&limit=10',
    'https://api.myanimelist.net/v2/anime?q=anime&offset=0&limit=10',
    'https://api.myanimelist.net/v2/anime?q=anime&offset=11&limit=10',
    'https://api.myanimelist.net/v2/anime?q=anime&offset=10&limit=100',
    'https://api.myanimelist.net/v2/anime?q=anime&offset=10&offset=20&limit=10',
    'not a URL',
  ])('rejects malformed or unrelated provider pagination without following its URL: %s', async next => {
    const fetcher = fake(() => response({ data: [{ node: row(1) }], paging: { next } }));
    await expect(createMalService('id', fetcher).searchPage!('anime', 0)).rejects.toMatchObject({ status: 502 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('bounds background requests to three, reserving one upstream slot for search', async () => {
    let current = 0; let peak = 0;
    const fetcher = fake(async url => {
      current++; peak = Math.max(peak, current);
      await new Promise(resolve => setTimeout(resolve, 5));
      current--;
      return response(row(Number(url.pathname.split('/').pop()), { media_type: 'tv' }));
    });
    await createMalService('id', fetcher).titles(Array.from({ length: 8 }, (_, i) => `mal:${i + 1}`));
    expect(peak).toBe(3);
  });

  it('returns balanced recommendations after verifying candidate identities', async () => {
    const fetcher = fake(url => {
      const id = Number(url.pathname.split('/').pop());
      if (id === 1) return response(row(1, { recommendations: [edge(10, 1000), edge(11, 400), edge(12, 900)] }));
      if (id === 2) return response(row(2, { recommendations: [edge(20, 10), edge(11, 4)] }));
      return response(row(id));
    });
    const result = await createMalService('id', fetcher).recommend!(['mal:2', 'mal:1', 'mal:1'], 'both');
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(result.items[0]).toMatchObject({ title: { id: 'mal:11', anime: { detailsLoaded: true } }, score: expect.closeTo(0.4), communityMatch: { matchedSeeds: 2, totalSeeds: 2 } });
    expect(result.seeds.map(title => title.id)).toEqual(['mal:1', 'mal:2']);
    expect(result.catalogNote).toContain('additional community connections may exist');
  });

  it('normalizes before filtering after verifying show ancestry', async () => {
    const fetcher = fake(url => {
      const id = Number(url.pathname.split('/').pop());
      if (id === 1) return response(row(1, { recommendations: [edge(2, 100), edge(10, 50, { media_type: 'tv', synopsis: 'TV summary' }), edge(11, 25, { media_type: 'movie' }), edge(12, 10)] }));
      if (id === 2) return response(row(2, { recommendations: [] }));
      if (id === 12) return response(row(12, { media_type: 'movie', synopsis: 'Movie summary' }));
      if (id === 10) return response(row(10, { media_type: 'tv', synopsis: 'TV summary' }));
      throw new Error('Known formats should not be requested');
    });
    const result = await createMalService('id', fetcher).recommend!(['mal:1', 'mal:2'], 'movie');
    expect(result.items.map(item => item.title.id)).toEqual(['mal:11', 'mal:12']);
    expect(result.items[0].communityMatch?.connections[0].normalizedSupport).toBe(0.25);
    expect(result.items[0].score).toBeCloseTo(0.0625);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('retains absent recommendation sources in the score denominator', async () => {
    const fetcher = fake(url => response(url.pathname.endsWith('/1') ? row(1, { recommendations: [edge(10, 100)] }) : row(Number(url.pathname.split('/').pop()))));
    const result = await createMalService('id', fetcher).recommend!(['mal:1', 'mal:2'], 'both');
    expect(result.items[0].score).toBe(0.25);
    expect(result.note).toContain('some or all releases of Anime 2');
    expect(result.recommendationsComplete).toBe(false);
  });

  it.each([401, 403, 404, 429, 500])('handles HTTP %s without exposing credentials or upstream payload', async status => {
    const service = createMalService('private-id', fake(() => response({ error: 'private-id internal upstream payload' }, status, { 'retry-after': '60' })));
    try { await service.titles(['mal:1']); expect.fail('Expected catalog error'); }
    catch (error) {
      expect(String(error)).not.toContain('private-id');
      expect(String(error)).not.toContain('internal upstream payload');
      expect(error).toMatchObject({ status: status === 429 || status === 404 ? status : 503 });
    }
  });

  it('honors rate-limit backoff without holding the request open', async () => {
    const fetcher = fake(() => response({}, 429, { 'retry-after': '60' }));
    const service = createMalService('id', fetcher);
    await expect(service.titles(['mal:1'])).rejects.toMatchObject({ status: 429 });
    await expect(service.titles(['mal:2'])).rejects.toMatchObject({ status: 429 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed IDs and malformed provider titles or counts', async () => {
    const fetcher = fake(() => response(row(2)));
    const service = createMalService('id', fetcher);
    await expect(service.titles(['mal:1/../../secret'])).rejects.toMatchObject({ status: 400 });
    await expect(service.titles(['mal:01'])).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(service.titles(['mal:1'])).rejects.toMatchObject({ status: 502 });
    const broken = createMalService('id', fake(() => response(row(1, { recommendations: [edge(2, -1)] }))));
    await expect(broken.recommend!(['mal:1'], 'both')).rejects.toMatchObject({ status: 502 });
  });

  it('rejects more than eight unique picks while accepting repeated picks', async () => {
    const fetcher = fake(url => response(row(Number(url.pathname.split('/').pop()), { recommendations: [] })));
    const service = createMalService('id', fetcher);
    await expect(service.recommend!(Array.from({ length: 9 }, (_, index) => `mal:${index + 1}`), 'both')).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
    const result = await service.recommend!(Array(9).fill('mal:1'), 'both');
    expect(result.seedIds).toEqual(['mal:1']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('fetches recommendation lists only for selected installments and reuses graph metadata', async () => {
    const fetcher = fake(url => {
      const id = Number(url.pathname.split('/').pop());
      const fields = url.searchParams.get('fields') ?? '';
      if (id === 1) {
        expect(fields).toContain('recommendations');
        return response(complete(1, { recommendations: [edge(2, 5)] }));
      }
      expect(fields).not.toContain('recommendations');
      return response(complete(id));
    });
    const service = createMalService('id', fetcher);
    await service.recommend!(['mal:1'], 'both');
    await service.titles(['mal:1', 'mal:2']);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('trusts fully expanded metadata, caches it, and still hydrates partially expanded nodes', async () => {
    const fetcher = fake(url => {
      const id = Number(url.pathname.split('/').pop());
      if (id === 1) return response(complete(1, { recommendations: [{ node: complete(2, { media_type: 'movie' }), num_recommendations: 5 }, edge(3, 3, { media_type: 'movie', synopsis: 'Partial' })] }));
      expect(id).toBe(3);
      return response(complete(3, { synopsis: 'Full synopsis' }));
    });
    const service = createMalService('id', fetcher);
    const result = await service.recommend!(['mal:1'], 'both');
    expect(result.items[0].title.anime?.detailsLoaded).toBe(true);
    expect(result.items[1].title.anime?.detailsLoaded).toBe(false);
    const hydrated = await service.hydrate!(['mal:2', 'mal:3']);
    expect(hydrated.titles).toHaveLength(2);
    expect(hydrated.titles[1].overview).toBe('Full synopsis');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('isolates missing candidate metadata while failing clearly for a missing selected title', async () => {
    const fetcher = fake(url => url.pathname.endsWith('/2') ? response({}, 404) : response(complete(1)));
    const service = createMalService('id', fetcher);
    const result = await service.hydrate!(['mal:1', 'mal:2']);
    expect(result.titles.map(title => title.id)).toEqual(['mal:1']);
    expect(result.unavailableIds).toEqual(['mal:2']);
    await expect(service.recommend!(['mal:1', 'mal:2'], 'both')).rejects.toMatchObject({ status: 404 });
  });

  it('preserves successful hydration when a sibling request times out', async () => {
    const fetcher = fake(url => {
      if (url.pathname.endsWith('/2')) throw new Error('Network timeout');
      return response(complete(1));
    });
    const result = await createMalService('id', fetcher).hydrate!(['mal:1', 'mal:2']);
    expect(result.titles.map(title => title.id)).toEqual(['mal:1']);
    expect(result.unavailableIds).toEqual(['mal:2']);
  });

  it('does not mistake unknown or music formats for series', async () => {
    const fetcher = fake(url => {
      if (url.pathname.endsWith('/1')) return response(complete(1, { recommendations: [edge(2, 100, { media_type: 'unknown' }), edge(3, 80, { media_type: 'music' }), edge(4, 50, { media_type: 'ova' }), edge(5, 10, { media_type: 'movie' })] }));
      const id = Number(url.pathname.split('/').pop());
      return response(complete(id, { media_type: ({ 2: 'unknown', 3: 'music', 4: 'ova' } as Record<number, string>)[id] }));
    });
    const result = await createMalService('id', fetcher).recommend!(['mal:1'], 'tv');
    expect(result.items.map(item => item.title.id)).toEqual(['mal:4']);
    expect(result.items[0].score).toBeCloseTo(0.5);
    expect(result.warning).toContain('no known format');
  });

  it('fails retryably when candidate identity cannot be verified', async () => {
    const fetcher = fake(url => url.pathname.endsWith('/1')
      ? response(complete(1, { recommendations: [edge(2, 100), edge(3, 50, { media_type: 'movie' })] }))
      : response({}, 500));
    await expect(createMalService('id', fetcher).recommend!(['mal:1'], 'movie')).rejects.toMatchObject({ status: 503 });
    const unavailable = createMalService('id', fake(url => url.pathname.endsWith('/1')
      ? response(complete(1, { recommendations: [edge(2, 100)] })) : response({}, 500)));
    await expect(unavailable.recommend!(['mal:1'], 'movie')).rejects.toMatchObject({ status: 503 });
  });

  it('stops launching identity lookups after a provider failure', async () => {
    const fetcher = fake(url => url.pathname.endsWith('/1')
      ? response(complete(1, { recommendations: [...Array.from({ length: 10 }, (_, index) => edge(index + 2, 100 - index)), edge(20, 1, { media_type: 'movie' })] }))
      : response({}, 500));
    await expect(createMalService('id', fetcher).recommend!(['mal:1'], 'movie')).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('verifies the full pool before filtering without the old 120-lookup truncation', async () => {
    const fetcher = fake(url => {
      const id = Number(url.pathname.split('/').pop());
      if (id === 1) return response(complete(1, { recommendations: [...Array.from({ length: 121 }, (_, index) => edge(index + 100, 200 - index)), edge(300, 1, { media_type: 'movie' })] }));
      return response(complete(id));
    });
    const result = await createMalService('id', fetcher).recommend!(['mal:1'], 'movie');
    expect(result.items.map(item => item.title.id)).toEqual(['mal:300']);
    expect(fetcher).toHaveBeenCalledTimes(122);
    expect(result.candidateCount).toBe(122);
    expect(result.recommendationsComplete).toBe(true);
  });

  it('distinguishes authentication failure from forbidden access and forwards retry timing', async () => {
    const auth = createMalService('id', fake(() => response({}, 401)));
    await expect(auth.search('anime')).rejects.toMatchObject({ status: 503, message: expect.stringContaining('authenticated'), retryAfterSeconds: 30 });
    const forbidden = createMalService('id', fake(() => response({}, 403, { 'retry-after': '600' })));
    await expect(forbidden.search('anime')).rejects.toMatchObject({ status: 503, message: expect.stringContaining('refusing requests'), retryAfterSeconds: 600 });
    const unavailable = createMalService('id', fake(() => response({}, 503, { 'retry-after': '60' })));
    await expect(unavailable.search('anime')).rejects.toMatchObject({ status: 503, retryAfterSeconds: 60 });
  });

  it('keeps queues and response caches local to each service instance', async () => {
    const blocked = createMalService('one', fake(() => response({}, 429)));
    await expect(blocked.search('same')).rejects.toMatchObject({ status: 429 });
    const fetcher = fake(() => response({ data: [{ node: row(1) }] }));
    const separate = createMalService('two', fetcher);
    expect(await separate.search('same')).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('serves search while background metadata slots are occupied', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let detailsStarted = 0;
    const fetcher = fake(async url => {
      if (url.pathname === '/v2/anime') return response({ data: [{ node: row(99) }] });
      detailsStarted++;
      await blocked;
      return response(complete(Number(url.pathname.split('/').pop())));
    });
    const service = createMalService('id', fetcher);
    const details = service.titles(Array.from({ length: 8 }, (_, index) => `mal:${index + 1}`));
    expect(detailsStarted).toBe(3);
    try { expect((await service.search('active'))[0].id).toBe('mal:99'); }
    finally { release(); }
    await details;
  });

  it('expires stale queued metadata requests instead of retaining them indefinitely', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const service = createMalService('id', fake(async url => { await blocked; return response(complete(Number(url.pathname.split('/').pop()))); }));
    const details = service.titles(['mal:1', 'mal:2', 'mal:3', 'mal:4']);
    const rejected = expect(details).rejects.toMatchObject({ status: 503, message: expect.stringContaining('waited too long') });
    try {
      await vi.advanceTimersByTimeAsync(8001);
      await rejected;
    } finally {
      release();
      await vi.runAllTimersAsync();
      vi.useRealTimers();
      await service.close?.();
    }
  });

  it('expires cached responses and never treats a failure as a cached empty result', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetcher = fake(() => { calls++; return calls === 1 ? response({}, 500) : response({ data: [] }); });
    const service = createMalService('id', fetcher);
    try {
      await expect(service.search('same')).rejects.toMatchObject({ status: 503 });
      expect(await service.search('same')).toEqual([]);
      expect(await service.search('same')).toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
      await service.search('same');
      expect(fetcher).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); await service.close?.(); }
  });
});
