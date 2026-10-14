import { describe, expect, it, vi } from 'vitest';
import { createMalService } from './mal-service';
import { beforeAnimeDeadline } from './anime-series';

type Fixture = { format?: string; links?: [string, number][]; recs?: [number, number][] };
function fixture(rows: Record<number, Fixture>) {
  const calls: { id: number; recommendations: boolean }[] = [];
  const node = (id: number) => ({ id, title: `Release ${id}`, media_type: rows[id]?.format ?? 'tv', start_date: `${2000 + id}-01-01`, mean: id === 1 ? 7 : 9 });
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    const parsed = new URL(String(url));
    const id = Number(parsed.pathname.split('/').pop());
    const recommendations = (parsed.searchParams.get('fields') ?? '').includes('recommendations');
    calls.push({ id, recommendations });
    const row = rows[id];
    if (!row) return Response.json({}, { status: 404 });
    return Response.json({ ...node(id), related_anime: (row.links ?? []).map(([relation_type, other]) => ({ relation_type, node: node(other) })),
      ...(recommendations ? { recommendations: (row.recs ?? []).map(([other, num_recommendations]) => ({ node: node(other), num_recommendations })) } : {}),
    });
  }) as unknown as typeof fetch;
  return { service: createMalService('fixture', fetcher), calls };
}

describe('whole-show recommendation assembly', () => {
  const rows: Record<number, Fixture> = {
    1: { links: [['sequel', 21]], recs: [[2, 1000], [10, 400], [20, 600]] },
    21: { format: 'movie', links: [['prequel', 1], ['sequel', 2]], recs: [[99, 1000]] },
    2: { links: [['prequel', 21]], recs: [[11, 9], [20, 10]] },
    3: { recs: [[1, 100], [10, 40], [20, 10]] },
    10: { links: [['sequel', 11]] }, 11: { links: [['prequel', 10]] },
    20: { format: 'movie' }, 99: {},
  };

  it('normalizes each original list, collapses both source and candidate seasons, and excludes movie votes', async () => {
    const { service, calls } = fixture(rows);
    const result = await service.recommend!(['mal:2', 'mal:3'], 'both');
    expect(result.seeds.map(title => title.id)).toEqual(['mal:1', 'mal:3']);
    expect(result.items.map(item => item.title.id)).toEqual(['mal:10', 'mal:20']);
    expect(result.items[0].score).toBeCloseTo(0.625);
    expect(result.items[0].communityMatch?.connections[0]).toMatchObject({ recommendations: 9, normalizedSupport: 0.9 });
    expect(result.seeds[0].anime?.series?.installments.map(title => title.id)).toEqual(['mal:1', 'mal:2']);
    expect(result.seeds[0].anime?.series?.relatedMovies.map(title => title.id)).toEqual(['mal:21']);
    expect(result.seeds[0].anime?.communityScore).toBe(7);
    expect(calls.filter(call => call.recommendations).map(call => call.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(result).toMatchObject({ candidateCount: 2, matchedCandidateCount: 2, recommendationsComplete: true, warning: null });
    const coldCalls = calls.length;
    const again = await service.recommend!(['mal:3', 'mal:1', 'mal:2'], 'both');
    expect(again).toEqual(result);
    expect(calls).toHaveLength(coldCalls);
    const movie = await service.recommend!(['mal:3', 'mal:1'], 'movie');
    expect(movie.items).toEqual(result.items.filter(item => item.title.type === 'movie'));
  });

  it('keeps a selected movie as its own input, even when it bridges a show', async () => {
    const { service } = fixture(rows);
    const movie = await service.recommend!(['mal:21'], 'both');
    expect(movie.seedIds).toEqual(['mal:21']);
    expect(movie.seeds[0].anime?.series).toBeUndefined();
    expect(movie.items.map(item => item.title.id)).toEqual(['mal:99']);
    const detail = await service.series!('mal:2');
    expect(detail.id).toBe('mal:2');
    expect(detail.anime?.series?.id).toBe('mal:1');
  });

  it('returns all thirty-five real matches, with no repeated pages or filler', async () => {
    const candidates = Array.from({ length: 35 }, (_, index) => index + 100);
    const { service } = fixture({ 1: { recs: candidates.map((id, index) => [id, 35 - index]) }, ...Object.fromEntries(candidates.map(id => [id, { format: 'movie' }])) });
    const result = await service.recommend!(['mal:1'], 'both');
    expect(result.items.map(item => item.title.id)).toEqual(candidates.map(id => `mal:${id}`));
    expect(result.candidateCount).toBe(35);
    expect(result.recommendationsComplete).toBe(true);
  });

  it('isolates a genuinely unavailable candidate and marks the snapshot incomplete', async () => {
    const { service } = fixture({ 1: { recs: [[2, 100], [3, 40]] }, 3: {} });
    const result = await service.recommend!(['mal:1'], 'both');
    expect(result.items.map(item => item.title.id)).toEqual(['mal:3']);
    expect(result.items[0].score).toBeCloseTo(0.4);
    expect(result.recommendationsComplete).toBe(false);
    expect(result.warning).toContain('no longer available');
  });

  it('enforces the shared deadline even while joining work started by another request', async () => {
    vi.useFakeTimers();
    try {
      const pending = new Promise<string>(() => {});
      const result = beforeAnimeDeadline(pending, Date.now() + 1000);
      const rejected = expect(result).rejects.toMatchObject({ status: 503, retryAfterSeconds: 2 });
      await vi.advanceTimersByTimeAsync(1001);
      await rejected;
    } finally { vi.useRealTimers(); }
  });
});
