import { describe, expect, it } from 'vitest';
import { balancedCommunityScore, matchesAnimeOutput, rankAnimeRecommendations, type AnimeRecommendationSeed } from './anime-ranker';
import type { MediaTitle } from '../shared/types';

const title = (id: number, type: 'movie' | 'tv' = 'tv'): MediaTitle => ({ id: `mal:${id}`, title: `Anime ${id}`, type, year: null, posterUrl: null, overview: '', genres: [], sources: [], traits: {} });
const seed = (id: number, edges: [number, number][]): AnimeRecommendationSeed => ({ title: title(id), recommendations: edges.map(([id, recommendations]) => ({ title: title(id), recommendations })) });

describe('balanced MAL community recommendations', () => {
  it('gives each input equal influence despite a 100x difference in community counts', () => {
    const result = rankAnimeRecommendations([seed(1, [[10, 1000], [11, 400], [12, 900]]), seed(2, [[20, 10], [11, 4]])]);
    expect(result.items.find(item => item.title.id === 'mal:11')?.score).toBeCloseTo(0.4);
    expect(result.items.find(item => item.title.id === 'mal:12')?.score).toBeCloseTo(0.225);
    expect(result.items[0].title.id).toBe('mal:11');
  });

  it('is invariant to source count scale, input order, duplicate picks, duplicate edges and edge order', () => {
    const a = seed(1, [[10, 100], [11, 50], [12, 1]]);
    const b = seed(2, [[12, 20], [11, 10]]);
    const expected = rankAnimeRecommendations([a, b]);
    expect(rankAnimeRecommendations([b, { ...a, recommendations: [...a.recommendations, a.recommendations[0]].reverse() }, a])).toEqual(expected);
    const scaled = rankAnimeRecommendations([{ ...a, recommendations: a.recommendations.map(edge => ({ ...edge, recommendations: edge.recommendations * 1000 })) }, b]);
    expect(scaled.items.map(item => [item.title.id, item.score])).toEqual(expected.items.map(item => [item.title.id, item.score]));
    expect(balancedCommunityScore([0.7, 0.1, 0.2])).toBe(balancedCommunityScore([0.2, 0.7, 0.1]));
  });

  it('normalizes before selected-title exclusion and format filtering', () => {
    const a = seed(1, [[2, 100], [10, 50], [11, 25]]);
    a.recommendations[2].title.type = 'movie';
    const result = rankAnimeRecommendations([a, seed(2, [])], { type: 'movie' });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title.id).toBe('mal:11');
    expect(result.items[0].communityMatch?.connections[0].normalizedSupport).toBe(0.25);
    expect(result.items[0].score).toBeCloseTo(0.0625);
  });

  it('keeps empty and unavailable seeds in the denominator and explains them', () => {
    const missing = { ...seed(2, []), recommendationsAvailable: false };
    const result = rankAnimeRecommendations([seed(1, [[10, 20]]), missing]);
    expect(result.items[0].score).toBe(0.25);
    expect(result.items[0].communityMatch).toMatchObject({ matchedSeeds: 1, totalSeeds: 2 });
    expect(result.note).toContain('some or all releases of Anime 2');
    expect(result.note).toContain('equal weight');
    expect(rankAnimeRecommendations([seed(1, [])]).note).toContain('returned no community recommendations');
  });

  it('preserves single-seed count ordering with stable ID tie breaks', () => {
    const result = rankAnimeRecommendations([seed(1, [[50, 20], [10, 100], [3, 100]])]);
    expect(result.items.map(item => item.title.id)).toEqual(['mal:3', 'mal:10', 'mal:50']);
    expect(result.items[2].score).toBeCloseTo(0.2);
  });

  it('has no dependence on overall ratings and ignores malformed counts', () => {
    const a = seed(1, [[10, 3], [11, 1], [12, -5], [13, NaN], [14, Infinity]]);
    const ranked = rankAnimeRecommendations([a]);
    expect(ranked.items.map(item => item.title.id)).toEqual(['mal:10', 'mal:11']);
    expect(balancedCommunityScore([])).toBe(0);
    expect(balancedCommunityScore([1, 1])).toBe(1);
    expect(balancedCommunityScore([0, 0])).toBe(0);
  });

  it('retains support under positive fractional rescaling and irrelevant metadata changes', () => {
    const a = seed(1, [[10, 7], [11, 3], [12, 1]]);
    const b = seed(2, [[10, 1], [11, 7], [12, 2]]);
    const expected = rankAnimeRecommendations([a, b]);
    const rescaled = rankAnimeRecommendations([{ ...a, recommendations: a.recommendations.map(edge => ({ recommendations: edge.recommendations * 0.123, title: { ...edge.title, overview: 'New synopsis', year: 2026, genres: ['Comedy'], runtime: 90 } })) }, b]);
    expect(rescaled.items.map(item => item.title.id)).toEqual(expected.items.map(item => item.title.id));
    rescaled.items.forEach((item, index) => expect(item.score).toBeCloseTo(expected.items[index].score, 12));
  });

  it('classifies anime formats explicitly while leaving unknown and music in All only', () => {
    const anime = (format: string) => ({ ...title(10), anime: { format } } as MediaTitle);
    for (const format of ['tv', 'ova', 'ona', 'special', 'tv_special']) expect(matchesAnimeOutput(anime(format), 'tv')).toBe(true);
    for (const format of ['unknown', 'music', 'movie', 'unrecognized']) expect(matchesAnimeOutput(anime(format), 'tv')).toBe(false);
    expect(matchesAnimeOutput(anime('movie'), 'movie')).toBe(true);
    expect(matchesAnimeOutput(anime('unknown'), 'both')).toBe(true);
    expect(matchesAnimeOutput(anime('music'), 'both')).toBe(true);
  });

  it('takes the strongest normalized release connection once per show, without summing season votes', () => {
    const firstRelease = { ...seed(1, [[1, 1000], [10, 400], [20, 600]]), normalizationMaximum: 1000 };
    const laterRelease = { ...seed(1, [[10, 9], [20, 10]]), normalizationMaximum: 10 };
    const secondShow = seed(3, [[1, 100], [10, 40], [20, 10]]);
    const result = rankAnimeRecommendations([firstRelease, laterRelease, secondShow]);
    expect(result.seedIds).toEqual(['mal:1', 'mal:3']);
    expect(result.items[0]).toMatchObject({ title: { id: 'mal:10' }, score: expect.closeTo(0.625) });
    expect(result.items[0].communityMatch?.connections[0]).toMatchObject({ recommendations: 9, normalizedSupport: 0.9 });
    expect(rankAnimeRecommendations([secondShow, laterRelease, firstRelease, laterRelease])).toEqual(result);
  });

  it('returns all supported candidates by default with stable sorting beyond twenty-four', () => {
    const result = rankAnimeRecommendations([seed(1, Array.from({ length: 60 }, (_, index) => [index + 10, 60 - index]))]);
    expect(result.items).toHaveLength(60);
    expect(result.items.at(-1)?.title.id).toBe('mal:69');
  });
});
