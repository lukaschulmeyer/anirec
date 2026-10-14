import type { MediaTitle, OutputType, RankResult, RankedTitle } from '../shared/types';

export interface AnimeRecommendationEdge {
  title: MediaTitle;
  recommendations: number;
}

export interface AnimeRecommendationSeed {
  title: MediaTitle;
  recommendations: AnimeRecommendationEdge[];
  /** Maximum of this original release's unfiltered MAL list, before canonical grouping. */
  normalizationMaximum?: number;
  /** A missing upstream field is distinct from an explicitly empty list. */
  recommendationsAvailable?: boolean;
}

function compareIds(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

function preferMetadata(a: MediaTitle, b: MediaTitle): MediaTitle {
  const completeness = (t: MediaTitle) => Number(Boolean(t.anime?.detailsLoaded)) * 8 + Number(Boolean(t.overview)) * 4 + Number(Boolean(t.posterUrl)) * 2 + Number(Boolean(t.anime?.format && t.anime.format !== 'unknown'));
  const difference = completeness(a) - completeness(b);
  if (difference) return difference > 0 ? a : b;
  return JSON.stringify(a).localeCompare(JSON.stringify(b), 'en') <= 0 ? a : b;
}

/** The broad movie/TV field is insufficient to classify unknown anime formats. */
export function matchesAnimeOutput(title: MediaTitle, type: OutputType): boolean {
  if (type === 'both') return true;
  if (!title.anime) return title.type === type;
  if (type === 'movie') return title.anime.format === 'movie';
  return ['tv', 'ova', 'ona', 'special', 'tv_special'].includes(title.anime.format);
}

/** Equal input weight; scores are relative support, never probabilities of enjoyment. */
export function balancedCommunityScore(support: readonly number[]): number {
  if (!support.length) return 0;
  const sum = [...support].sort((a, b) => a - b).reduce((total, value) => total + Math.sqrt(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))), 0);
  return (sum / support.length) ** 2;
}

export function rankAnimeRecommendations(
  inputs: readonly AnimeRecommendationSeed[],
  options: { type?: OutputType; limit?: number } = {},
): RankResult {
  const seeds = new Map<string, { title: MediaTitle; edges: Map<string, AnimeRecommendationEdge & { support: number }>; available: boolean }>();
  for (const input of inputs) {
    let seed = seeds.get(input.title.id);
    if (!seed) {
      seed = { title: input.title, edges: new Map(), available: input.recommendationsAvailable !== false };
      seeds.set(input.title.id, seed);
    } else {
      seed.title = preferMetadata(seed.title, input.title);
      seed.available &&= input.recommendationsAvailable !== false;
    }
    // Each input is an original release list. Multiple releases can share a show ID.
    const maximum = input.normalizationMaximum ?? Math.max(0, ...input.recommendations.map(edge => Number.isFinite(edge.recommendations) ? edge.recommendations : 0));
    for (const edge of input.recommendations) {
      if (!Number.isFinite(edge.recommendations) || edge.recommendations <= 0) continue;
      const support = maximum > 0 ? Math.min(1, edge.recommendations / maximum) : 0;
      const existing = seed.edges.get(edge.title.id);
      const strongest = !existing || support > existing.support || (support === existing.support && edge.recommendations > existing.recommendations) ? { ...edge, support } : existing;
      seed.edges.set(edge.title.id, { ...strongest, title: existing ? preferMetadata(existing.title, edge.title) : edge.title });
    }
  }
  const orderedSeeds = [...seeds.values()].sort((a, b) => compareIds(a.title.id, b.title.id));
  const seedIds = orderedSeeds.map(seed => seed.title.id);
  const selected = new Set(seedIds);
  const candidates = new Map<string, MediaTitle>();
  for (const seed of orderedSeeds) {
    for (const edge of seed.edges.values()) {
      if (selected.has(edge.title.id)) continue;
      const previous = candidates.get(edge.title.id);
      candidates.set(edge.title.id, previous ? preferMetadata(previous, edge.title) : edge.title);
    }
  }
  const ranked: RankedTitle[] = [];
  for (const candidate of candidates.values()) {
    if (options.type && !matchesAnimeOutput(candidate, options.type)) continue;
    const connections = orderedSeeds.map(seed => {
      const recommendations = seed.edges.get(candidate.id)?.recommendations ?? 0;
      return { seedId: seed.title.id, seedTitle: seed.title.title, recommendations, normalizedSupport: seed.edges.get(candidate.id)?.support ?? 0 };
    });
    const matchedSeeds = connections.filter(connection => connection.recommendations > 0).length;
    const totalSeeds = orderedSeeds.length;
    ranked.push({
      title: candidate,
      score: balancedCommunityScore(connections.map(connection => connection.normalizedSupport)),
      explanation: totalSeeds === 1
        ? `MAL users recommend this alongside ${connections[0].seedTitle}.`
        : matchedSeeds === totalSeeds
          ? `Recommended alongside all ${totalSeeds} of your picks on MyAnimeList.`
          : `Recommended alongside ${matchedSeeds} of your ${totalSeeds} picks on MyAnimeList.`,
      sharedTraits: [], seedFits: [], confidence: 'limited',
      communityMatch: { matchedSeeds, totalSeeds, connections },
    });
  }
  ranked.sort((a, b) => b.score - a.score || compareIds(a.title.id, b.title.id));
  const missing = orderedSeeds.filter(seed => !seed.available);
  const empty = orderedSeeds.filter(seed => seed.available && seed.edges.size === 0);
  const notes: string[] = [];
  if (missing.length) notes.push(`MyAnimeList did not return recommendation data for some or all releases of ${missing.map(seed => seed.title.title).join(', ')}.`);
  if (empty.length) notes.push(`MyAnimeList returned no community recommendations for ${empty.map(seed => seed.title.title).join(', ')}.`);
  if ((missing.length || empty.length) && orderedSeeds.length > 1) notes.push('Those picks still have equal weight; their connections are unknown.');
  const conflicting = orderedSeeds.length > 1 && ranked.length > 0 && !ranked.some(row => row.communityMatch?.matchedSeeds === orderedSeeds.length);
  if (conflicting) notes.push('No returned recommendation connects to every pick. These are the strongest partial matches.');
  const limit = options.limit === undefined ? ranked.length : Math.max(0, Math.floor(options.limit));
  return {
    items: ranked.slice(0, limit),
    note: notes.join(' ') || null,
    signals: { sparse: missing.length > 0 || empty.length > 0, conflicting },
    seedIds,
  };
}
