import { describe, expect, it } from 'vitest';
import { createAnimeSeriesResolver, type AnimeRelationNode } from './anime-series';
import { fromMal } from './mal-service';

const title = (id: number, format = 'tv') => fromMal({ id, title: `Release ${id}`, media_type: format, start_date: `${2000 + id}-01-01` }, true);
function resolver(rows: Record<number, { format?: string; links?: [string, number][] }>) {
  const nodes = new Map(Object.entries(rows).map(([id, row]) => [Number(id), { title: title(Number(id), row.format), relations: (row.links ?? []).map(([type, other]) => ({ type, title: title(other, rows[other]?.format) })) } satisfies AnimeRelationNode]));
  return createAnimeSeriesResolver(async id => {
    const node = nodes.get(Number(id.slice(4)));
    if (!node) throw new Error(`Missing fixture ${id}`);
    return node;
  });
}

describe('verified anime show continuity', () => {
  it('groups the full main chain including TV specials, with no invented season labels', async () => {
    const graph = resolver({ 1: { links: [['sequel', 2], ['side_story', 9], ['alternative_version', 8]] }, 2: { links: [['prequel', 1], ['sequel', 3]] }, 3: { format: 'tv_special', links: [['prequel', 2]] }, 8: {}, 9: { format: 'ova' } });
    const result = await graph.series('mal:2');
    expect(result.id).toBe('mal:2');
    expect(result.anime?.series).toMatchObject({ id: 'mal:1', complete: true });
    expect(result.anime?.series?.installments.map(part => part.id)).toEqual(['mal:1', 'mal:2', 'mal:3']);
    expect(result.anime?.series?.installments.every(part => !part.anime?.series)).toBe(true);
    expect((await graph.canonical('mal:3')).id).toBe('mal:1');
  });

  it('excludes recap prequels using summary/full_story while keeping a selected recap separate', async () => {
    const graph = resolver({ 1: { links: [['sequel', 2], ['summary', 9]] }, 2: { links: [['prequel', 1], ['prequel', 9]] }, 9: { format: 'tv_special', links: [['full_story', 1], ['sequel', 2]] } });
    expect((await graph.series('mal:2')).anime?.series?.installments.map(part => part.id)).toEqual(['mal:1', 'mal:2']);
    expect((await graph.canonical('mal:9')).id).toBe('mal:9');
    expect((await graph.series('mal:9')).anime?.series?.installments.map(part => part.id)).toEqual(['mal:9']);
  });

  it('crosses movie bridges and retains a parallel TV adaptation without merging movie IDs', async () => {
    const graph = resolver({
      1: { links: [['sequel', 4], ['sequel', 2], ['summary', 8]] },
      4: { format: 'movie', links: [['prequel', 1], ['sequel', 3], ['alternative_version', 2]] },
      2: { links: [['prequel', 1], ['sequel', 3], ['alternative_version', 4]] },
      3: { links: [['prequel', 4], ['prequel', 2]] },
      8: { format: 'movie', links: [['full_story', 1]] },
    });
    expect((await graph.canonical('mal:3')).id).toBe('mal:1');
    const result = await graph.series('mal:3');
    expect(result.anime?.series?.installments.map(part => part.id)).toEqual(['mal:1', 'mal:2', 'mal:3']);
    expect(result.anime?.series?.relatedMovies.map(part => part.id)).toEqual(['mal:4', 'mal:8']);
    expect((await graph.canonical('mal:4')).id).toBe('mal:4');
    expect((await graph.series('mal:4')).anime?.series).toBeUndefined();
  });

  it('does not change canonical identity when a one-sided relation is encountered in another request', async () => {
    const graph = resolver({ 1: { links: [['sequel', 2]] }, 2: {} });
    expect((await graph.canonical('mal:2')).id).toBe('mal:2');
    await expect(graph.series('mal:1')).rejects.toMatchObject({ status: 503, retryAfterSeconds: 5 });
    expect((await graph.canonical('mal:2')).id).toBe('mal:2');
  });

  it('fails closed on a bounded traversal instead of calling it complete', async () => {
    const rows = Object.fromEntries(Array.from({ length: 81 }, (_, index) => [index + 1, { links: [...(index ? [['prequel', index]] : []), ...(index < 80 ? [['sequel', index + 2]] : [])] as [string, number][] }]));
    await expect(resolver(rows).series('mal:1')).rejects.toMatchObject({ status: 503, message: expect.stringContaining('more linked releases') });
  });

  it('hydrates a compact continuity neighbor before classifying it', async () => {
    const graph = createAnimeSeriesResolver(async id => id === 'mal:2'
      ? { title: title(2), relations: [{ type: 'prequel', title: title(1, 'unknown') }] }
      : { title: title(1), relations: [{ type: 'sequel', title: title(2) }] });
    expect((await graph.canonical('mal:2')).id).toBe('mal:1');
    expect((await graph.series('mal:2')).anime?.series?.installments.map(part => part.id)).toEqual(['mal:1', 'mal:2']);
  });

  it('does not merge independent shows when their sequels converge', async () => {
    const graph = resolver({ 1: { links: [['sequel', 3]] }, 2: { links: [['sequel', 3]] }, 3: { links: [['prequel', 1], ['prequel', 2]] } });
    expect((await graph.canonical('mal:2')).id).toBe('mal:2');
    await expect(graph.canonical('mal:3')).rejects.toMatchObject({ status: 503, message: expect.stringContaining('independent shows') });
    await expect(graph.series('mal:1')).rejects.toMatchObject({ status: 503 });
    expect((await graph.canonical('mal:2')).id).toBe('mal:2');
  });

  it('recognizes independent episodic roots even when each starts after a film', async () => {
    const graph = resolver({
      1: { links: [['prequel', 4], ['sequel', 3]] }, 2: { links: [['prequel', 5], ['sequel', 3]] },
      3: { links: [['prequel', 1], ['prequel', 2]] },
      4: { format: 'movie', links: [['sequel', 1]] }, 5: { format: 'movie', links: [['sequel', 2]] },
    });
    expect((await graph.canonical('mal:1')).id).toBe('mal:1');
    await expect(graph.canonical('mal:3')).rejects.toMatchObject({ status: 503, message: expect.stringContaining('independent shows') });
  });

  it('rejects cyclic episode chronology rather than inventing a root', async () => {
    const graph = resolver({ 1: { links: [['prequel', 2], ['sequel', 2]] }, 2: { links: [['prequel', 1], ['sequel', 1]] } });
    await expect(graph.canonical('mal:1')).rejects.toMatchObject({ status: 503, message: expect.stringContaining('cycle') });
  });

  it('keeps generic prequel specials separate instead of replacing a main TV show with its prologue', async () => {
    const graph = resolver({ 1: { format: 'special', links: [['sequel', 2]] }, 2: { links: [['prequel', 1], ['sequel', 3]] }, 3: { links: [['prequel', 2]] } });
    expect((await graph.canonical('mal:2')).id).toBe('mal:2');
    expect((await graph.canonical('mal:3')).id).toBe('mal:2');
    const result = await graph.series('mal:2');
    expect(result.anime?.series?.installments.map(part => part.id)).toEqual(['mal:2', 'mal:3']);
    expect((await graph.canonical('mal:1')).id).toBe('mal:1');
    expect((await graph.series('mal:1')).anime?.series).toBeUndefined();
  });

  it('keeps a selected recap separate when only incoming summary evidence is supplied', async () => {
    const graph = resolver({ 1: { links: [['summary', 2]] }, 2: { format: 'tv_special', links: [['prequel', 1]] } });
    expect((await graph.canonical('mal:2')).id).toBe('mal:2');
    expect((await graph.series('mal:2')).anime?.series?.installments.map(part => part.id)).toEqual(['mal:2']);
  });
});
