import type { MediaTitle, OutputType } from '../src/shared/types';
import { matchesAnimeOutput, rankAnimeRecommendations, type AnimeRecommendationSeed } from '../src/engine/anime-ranker';
import { CatalogError } from './catalog-error';
import type { CatalogService, PreparedRecommendations } from './anime-service';
import { beforeAnimeDeadline, createAnimeSeriesResolver } from './anime-series';

type MalObject = Record<string, unknown>;
const API = 'https://api.myanimelist.net/v2/';
const FIELDS = 'id,title,main_picture,alternative_titles,start_date,end_date,synopsis,mean,num_scoring_users,nsfw,genres,media_type,status,num_episodes,start_season,source,average_episode_duration,rating,studios';
// MAL documents nested field selection; recommendation nodes use AnimeForList.
// Missing expanded fields are handled as compact records, without inventing metadata.
const RELATION_FIELDS = `${FIELDS},related_anime{node{${FIELDS}},relation_type,relation_type_formatted}`;
const DETAIL_FIELDS = `${RELATION_FIELDS},recommendations{node{${FIELDS}},num_recommendations}`;
const RETURNED_LIST_NOTE = 'Results use recommendations returned by MyAnimeList; additional community connections may exist.';
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_LIMIT = 400;
const CACHE_BYTES_LIMIT = 8 * 1024 * 1024;
const MAX_CONCURRENCY = 4;
const MAX_RECOMMENDATION_RELEASES = 400;
const SEARCH_PAGE_SIZE = 10;

function searchOffset(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value % SEARCH_PAGE_SIZE !== 0) {
    throw new CatalogError('Choose a valid search results page.', 400);
  }
  return value;
}

function nextSearchOffset(value: MalObject, query: string, offset: number): number | null {
  if (value.paging === undefined || value.paging === null) return null;
  const paging = object(value.paging);
  if (!paging) throw new Error('Invalid pagination');
  if (paging.next === undefined || paging.next === null || paging.next === '') return null;
  if (typeof paging.next !== 'string') throw new Error('Invalid pagination');
  const next = new URL(paging.next);
  const rawOffset = next.searchParams.get('offset');
  const rawLimit = next.searchParams.get('limit');
  const nextQuery = next.searchParams.get('q');
  if (next.origin !== 'https://api.myanimelist.net' || next.pathname !== '/v2/anime' || next.username || next.password || next.hash ||
    next.searchParams.getAll('offset').length !== 1 || !rawOffset || !/^(0|[1-9]\d*)$/.test(rawOffset) ||
    (rawLimit !== null && rawLimit !== String(SEARCH_PAGE_SIZE)) || (nextQuery !== null && nextQuery !== query) ||
    next.searchParams.getAll('limit').length > 1 || next.searchParams.getAll('q').length > 1) throw new Error('Invalid pagination');
  const parsed = Number(rawOffset);
  if (!Number.isSafeInteger(parsed) || parsed <= offset || parsed % SEARCH_PAGE_SIZE !== 0) throw new Error('Invalid pagination');
  return parsed;
}

function object(value: unknown): MalObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as MalObject : undefined;
}
function text(value: unknown, limit = 1000): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null;
}
function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
function date(value: unknown): string | null {
  const result = text(value, 10);
  return result && /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(result) ? result : null;
}
function artwork(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['cdn.myanimelist.net', 'myanimelist.net', 'myanimelist.cdn-dena.com'].includes(url.hostname) && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}
function validTitle(value: unknown): value is MalObject {
  const row = object(value);
  return Boolean(row && positiveInteger(row.id) && text(row.title, 500));
}
function publicTitle(row: MalObject): boolean {
  return row.nsfw !== 'black';
}
function names(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.map(item => text(object(item)?.name)).filter((item): item is string => Boolean(item)))] : [];
}
function hasExpandedDetails(row: MalObject): boolean {
  // Presence, not truthiness: null and empty fields are legitimate provider facts.
  return FIELDS.split(',').every(field => Object.hasOwn(row, field));
}

/** Map only provider facts. Unknown values remain absent, empty, or null. */
export function fromMal(row: MalObject, detailsLoaded = false): MediaTitle {
  if (!validTitle(row)) throw new CatalogError('MyAnimeList returned an unreadable title. Please try again.', 502);
  const picture = object(row.main_picture);
  const alternatives = object(row.alternative_titles);
  const startDate = date(row.start_date);
  const format = text(row.media_type, 50) ?? 'unknown';
  const duration = typeof row.average_episode_duration === 'number' && Number.isFinite(row.average_episode_duration) && row.average_episode_duration > 0 ? row.average_episode_duration / 60 : null;
  const startSeason = object(row.start_season);
  const seasonName = text(startSeason?.season, 30);
  const seasonYear = positiveInteger(startSeason?.year);
  const score = typeof row.mean === 'number' && Number.isFinite(row.mean) && row.mean >= 0 && row.mean <= 10 ? row.mean : null;
  const medium = artwork(picture?.medium);
  const large = artwork(picture?.large);
  return {
    id: `mal:${row.id}`, title: text(row.title, 500)!, type: format === 'movie' ? 'movie' : 'tv',
    year: startDate ? Number(startDate.slice(0, 4)) : seasonYear,
    posterUrl: large ?? medium, posterPreviewUrl: medium ?? large,
    overview: text(row.synopsis, 30_000) ?? '', genres: names(row.genres),
    runtime: duration, traits: {},
    sources: [{ name: 'MyAnimeList', url: `https://myanimelist.net/anime/${row.id}`, note: 'Anime metadata and community recommendation counts from the official MyAnimeList API.' }],
    anime: {
      format, englishTitle: text(alternatives?.en), japaneseTitle: text(alternatives?.ja),
      synonyms: Array.isArray(alternatives?.synonyms) ? [...new Set(alternatives.synonyms.map(value => text(value)).filter((value): value is string => Boolean(value)))] : [],
      startDate, endDate: date(row.end_date), status: text(row.status, 60),
      episodes: positiveInteger(row.num_episodes), episodeMinutes: duration,
      studios: names(row.studios), communityScore: score, scoringUsers: positiveInteger(row.num_scoring_users),
      ageRating: text(row.rating, 50), sourceMaterial: text(row.source, 100),
      season: seasonName && seasonYear ? `${seasonName} ${seasonYear}` : null,
      detailsLoaded,
    },
  };
}

function parseIds(ids: string[]): string[] {
  if (!Array.isArray(ids) || !ids.length || ids.length > 64 || ids.some(id => typeof id !== 'string' || !/^mal:[1-9]\d{0,14}$/.test(id) || !Number.isSafeInteger(Number(id.slice(4))))) {
    throw new CatalogError('Please choose valid anime titles from search.', 400);
  }
  const unique = [...new Set(ids)].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  if (unique.length > 8) throw new CatalogError('Choose up to eight anime titles.', 400);
  return unique;
}

export function createMalService(clientId: string | undefined, fetcher: typeof fetch = fetch): CatalogService {
  const credential = clientId?.trim() ?? '';
  let connection: 'configured' | 'verified' | 'unavailable' = credential ? 'configured' : 'unavailable';
  const cache = new Map<string, { at: number; bytes: number; value: MalObject }>();
  let cacheBytes = 0;
  const pending = new Map<string, Promise<MalObject>>();
  let active = 0;
  let backgroundActive = 0;
  type QueuedRequest = { priority: number; run: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> };
  const waiting: QueuedRequest[] = [];
  let retryAfter = 0;
  let retryStatus = 429;
  let retryMessage = 'MyAnimeList is busy. Please wait a moment before trying again.';

  function cacheKey(path: string, query: Record<string, string>): string {
    const url = new URL(path, API);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
  }
  function remember(key: string, value: MalObject): void {
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (bytes > CACHE_BYTES_LIMIT / 4) return;
    const existing = cache.get(key);
    if (existing) { cacheBytes -= existing.bytes; cache.delete(key); }
    while (cache.size >= CACHE_LIMIT || cacheBytes + bytes > CACHE_BYTES_LIMIT) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cacheBytes -= cache.get(oldest)!.bytes;
      cache.delete(oldest);
    }
    cache.set(key, { at: Date.now(), bytes, value });
    cacheBytes += bytes;
  }
  function cooldownError(): CatalogError {
    return new CatalogError(retryMessage, retryStatus, Math.max(1, Math.ceil((retryAfter - Date.now()) / 1000)));
  }
  function cooldown(response: Response, status: number, message: string, fallbackSeconds = 0): void {
    const header = response.headers.get('retry-after');
    const seconds = header && /^\d+$/.test(header) ? Number(header) : null;
    const timestamp = seconds !== null ? Date.now() + seconds * 1000 : header ? Date.parse(header) : NaN;
    const next = Number.isFinite(timestamp) ? Math.max(Date.now() + 1000, timestamp) : Date.now() + fallbackSeconds * 1000;
    if (next > retryAfter) { retryAfter = next; retryStatus = status; retryMessage = message; }
  }

  function drainQueue(): void {
    waiting.sort((a, b) => b.priority - a.priority);
    while (active < MAX_CONCURRENCY) {
      // Preserve one slot for autocomplete while poster details are loading.
      const index = waiting.findIndex(job => job.priority === 2 || backgroundActive < MAX_CONCURRENCY - 1);
      if (index < 0) return;
      const job = waiting.splice(index, 1)[0];
      clearTimeout(job.timeout);
      active++;
      if (job.priority !== 2) backgroundActive++;
      job.run();
    }
  }
  function limited<T>(work: () => Promise<T>, priority: number, deadline: number): Promise<T> {
    if (waiting.length >= 64) return Promise.reject(new CatalogError('AniRec is finishing several anime requests. Please try again in a moment.', 503, 2));
    return new Promise<T>((resolve, reject) => {
      const job: QueuedRequest = {
        priority, reject,
        run: () => {
          void work().then(resolve, reject).finally(() => {
            active--;
            if (priority !== 2) backgroundActive--;
            drainQueue();
          });
        },
        timeout: setTimeout(() => {
          const index = waiting.indexOf(job);
          if (index >= 0) {
            waiting.splice(index, 1);
            reject(new CatalogError('The anime request waited too long. Please try again.', 503));
          }
        }, Math.max(0, Math.min(8000, deadline - Date.now()))),
      };
      waiting.push(job);
      drainQueue();
    });
  }
  function setupRequired(): never {
    throw new CatalogError('Anime search is not connected yet. Please try again later.', 503);
  }
  async function request(path: string, query: Record<string, string> = {}, priority = 0, deadline = Infinity): Promise<MalObject> {
    if (!credential) setupRequired();
    const key = cacheKey(path, query);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    if (hit) { cacheBytes -= hit.bytes; cache.delete(key); }
    if (pending.has(key)) return beforeAnimeDeadline(pending.get(key)!, deadline);
    if (Date.now() < retryAfter) throw cooldownError();
    const promise = limited(async () => {
      if (Date.now() < retryAfter) throw cooldownError();
      if (Date.now() >= deadline) throw new CatalogError('Verifying these anime connections took too long. Please try again.', 503, 2);
      let response: Response;
      try {
        response = await fetcher(key, { headers: { 'X-MAL-CLIENT-ID': credential, Accept: 'application/json' }, signal: AbortSignal.timeout(Math.max(1, Math.min(8_000, deadline - Date.now()))) });
      } catch {
        connection = 'unavailable';
        throw new CatalogError('MyAnimeList is taking too long to respond. Please try again.', 503);
      }
      if (response.status === 401) {
        connection = 'unavailable';
        cooldown(response, 503, 'The MyAnimeList connection could not be authenticated. Please try again later.', 30);
        throw cooldownError();
      }
      if (response.status === 403) {
        connection = 'unavailable';
        cooldown(response, 503, 'MyAnimeList is refusing requests from this connection. Please try again later.', 30);
        throw cooldownError();
      }
      if (response.status === 429) {
        cooldown(response, 429, 'MyAnimeList is busy. Please wait a moment before trying again.', 5);
        throw cooldownError();
      }
      if (response.status === 404) throw new CatalogError('This anime is no longer available on MyAnimeList. Please choose another title.', 404);
      if (!response.ok) {
        connection = 'unavailable';
        cooldown(response, 503, 'MyAnimeList could not complete this request. Please try again.');
        if (Date.now() < retryAfter) throw cooldownError();
        throw new CatalogError('MyAnimeList could not complete this request. Please try again.', 503);
      }
      let value: MalObject;
      try {
        const parsed = object(await response.json());
        if (!parsed || parsed.error) throw new Error('Unreadable response');
        if (path === 'anime' || path === 'anime/ranking') {
          if (!Array.isArray(parsed.data) || parsed.data.some(edge => !validTitle(object(edge)?.node))) throw new Error('Unreadable list');
          if (path === 'anime') nextSearchOffset(parsed, query.q, Number(query.offset));
        } else {
          const detail = /^anime\/([1-9]\d*)$/.exec(path);
          if (!detail || !validTitle(parsed) || parsed.id !== Number(detail[1])) throw new Error('Unreadable detail');
          if (parsed.recommendations !== undefined && (!Array.isArray(parsed.recommendations) || parsed.recommendations.length > 5000 || parsed.recommendations.some(edge => {
            const item = object(edge);
            return !item || !validTitle(item.node) || typeof item.num_recommendations !== 'number' || !Number.isSafeInteger(item.num_recommendations) || item.num_recommendations < 0;
          }))) throw new Error('Unreadable recommendation list');
          if (query.fields?.includes('related_anime') && (!Array.isArray(parsed.related_anime) || parsed.related_anime.length > 500 || parsed.related_anime.some(edge => {
            const item = object(edge);
            return !item || !validTitle(item.node) || !text(item.relation_type, 80);
          }))) throw new Error('Unreadable anime relationships');
        }
        value = parsed;
      } catch {
        connection = 'unavailable';
        throw new CatalogError('MyAnimeList returned an unreadable response. Please try again.', 502);
      }
      connection = 'verified';
      remember(key, value);
      // Seed graph responses also satisfy compact metadata requests for that title.
      if (query.fields === DETAIL_FIELDS || query.fields === RELATION_FIELDS) {
        const { recommendations: _recommendations, related_anime: _relations, ...metadata } = value;
        remember(cacheKey(path, { fields: FIELDS }), metadata);
        if (query.fields === DETAIL_FIELDS) {
          const { recommendations: _list, ...relations } = value;
          remember(cacheKey(path, { fields: RELATION_FIELDS }), relations);
        }
        for (const edge of [...(Array.isArray(value.recommendations) ? value.recommendations : []), ...(Array.isArray(value.related_anime) ? value.related_anime : [])]) {
          const node = object(object(edge)?.node);
          if (node && hasExpandedDetails(node)) remember(cacheKey(`anime/${node.id}`, { fields: FIELDS }), node);
        }
      } else if (Array.isArray(value.data)) {
        for (const edge of value.data) {
          const node = object(object(edge)?.node);
          if (node && hasExpandedDetails(node)) remember(cacheKey(`anime/${node.id}`, { fields: FIELDS }), node);
        }
      }
      return value;
    }, priority, deadline);
    pending.set(key, promise);
    try { return await beforeAnimeDeadline(promise, deadline); } finally { pending.delete(key); }
  }
  async function detail(id: string, graph = false, priority = 0, deadline = Infinity): Promise<MalObject> {
    const row = await request(`anime/${id.slice(4)}`, { fields: graph ? DETAIL_FIELDS : FIELDS }, priority, deadline);
    if (!publicTitle(row)) throw new CatalogError('This anime is outside the supported catalog.', 404);
    return row;
  }
  const seriesResolver = createAnimeSeriesResolver(async (id, deadline) => {
    const row = await request(`anime/${id.slice(4)}`, { fields: RELATION_FIELDS }, 1, deadline);
    if (!publicTitle(row)) throw new CatalogError('This anime is outside the supported catalog.', 404);
    return { title: fromMal(row, true), relations: (row.related_anime as MalObject[]).map(edge => ({ type: edge.relation_type as string, title: fromMal(object(edge.node)!, hasExpandedDetails(object(edge.node)!)) })) };
  });
  async function mapBounded<T, R>(values: T[], work: (value: T) => Promise<R>, deadline: number): Promise<R[]> {
    const results = new Array<R>(values.length);
    let cursor = 0;
    let failure: unknown;
    await Promise.all(Array.from({ length: Math.min(3, values.length) }, async () => {
      while (cursor < values.length && !failure) {
        const index = cursor++;
        try {
          if (Date.now() >= deadline) throw new CatalogError('Verifying these anime connections took too long. Please try again; completed lookups are cached.', 503, 2);
          results[index] = await work(values[index]);
        } catch (error) { failure ??= error; }
      }
    }));
    if (failure) throw failure;
    return results;
  }

  async function recommend(ids: string[], type: OutputType): Promise<PreparedRecommendations> {
    const selected = parseIds(ids);
    if (selected.length > 8) throw new CatalogError('Choose up to eight anime titles.', 400);
    if (!['both', 'movie', 'tv'].includes(type)) throw new CatalogError('Choose a valid anime format.', 400);
    // Queue, network, and joined in-flight reads share one budget below the 30-second host limit.
    const deadline = Date.now() + 24_000;
    // Selected graphs populate relation and metadata caches before continuity traversal.
    await mapBounded(selected, id => detail(id, true, 1, deadline), deadline);
    const expanded = await mapBounded(selected, id => seriesResolver.series(id, deadline), deadline);
    const shows = new Map<string, MediaTitle>();
    for (const title of expanded) {
      const group = title.anime?.series;
      const representative = group?.installments.find(part => part.id === group.id) ?? title;
      shows.set(representative.id, group ? { ...representative, anime: { ...representative.anime!, series: group } } : title);
    }
    const seeds = [...shows.values()].sort((a, b) => Number(a.id.slice(4)) - Number(b.id.slice(4)));
    const releaseOwners = new Map<string, MediaTitle>();
    for (const title of seeds) for (const release of title.anime?.series?.installments ?? [title]) releaseOwners.set(release.id, title);
    if (releaseOwners.size > MAX_RECOMMENDATION_RELEASES) throw new CatalogError('These shows have too many releases to verify together. Please choose fewer shows.', 503, 5);
    const rows = await mapBounded([...releaseOwners.keys()].sort(), id => detail(id, true, 1, deadline), deadline);
    const candidateNodes = new Map<string, MalObject>();
    for (const row of rows) for (const raw of Array.isArray(row.recommendations) ? row.recommendations : []) {
      const node = object(object(raw)!.node)!;
      if (publicTitle(node)) candidateNodes.set(`mal:${node.id}`, node);
    }
    if (candidateNodes.size > MAX_RECOMMENDATION_RELEASES) throw new CatalogError('These shows returned too many connected releases to verify together. Please choose fewer shows.', 503, 5);
    const candidates = new Map<string, MediaTitle>();
    let unavailable = 0;
    await mapBounded([...candidateNodes.entries()].sort(([a], [b]) => Number(a.slice(4)) - Number(b.slice(4))), async ([id, node]) => {
      try {
        // Films retain their own identities. Every episodic release requires ancestry.
        const title = node.media_type === 'movie' ? fromMal(node, hasExpandedDetails(node)) : await seriesResolver.canonical(id, deadline);
        candidates.set(id, title);
      } catch (error) {
        if (error instanceof CatalogError && error.status === 404) { unavailable++; return; }
        throw error;
      }
    }, deadline);
    const inputs: AnimeRecommendationSeed[] = rows.map(row => {
      const edges = (Array.isArray(row.recommendations) ? row.recommendations : []).map(raw => object(raw)!);
      return {
        title: releaseOwners.get(`mal:${row.id}`)!, recommendationsAvailable: Array.isArray(row.recommendations),
        normalizationMaximum: Math.max(0, ...edges.map(edge => edge.num_recommendations as number)),
        recommendations: edges.flatMap(edge => {
          const title = candidates.get(`mal:${object(edge.node)!.id}`);
          return title ? [{ title, recommendations: edge.num_recommendations as number }] : [];
        }),
      };
    });
    const ranking = rankAnimeRecommendations(inputs);
    const items = ranking.items.filter(item => matchesAnimeOutput(item.title, type));
    const missingLists = rows.some(row => !Array.isArray(row.recommendations));
    const unknownFormats = type !== 'both' && ranking.items.some(item => item.title.anime?.format === 'unknown');
    const warnings = [unavailable ? 'Some recommended releases are no longer available on MyAnimeList.' : null,
      missingLists ? 'MyAnimeList omitted recommendation data for one or more installments.' : null,
      unknownFormats ? 'Some releases have no known format and are excluded from this filter.' : null].filter(Boolean);
    return {
      ...ranking, items, seeds, candidateCount: ranking.items.length, matchedCandidateCount: items.length,
      catalogNote: RETURNED_LIST_NOTE, recommendationsComplete: warnings.length === 0, warning: warnings.join(' ') || null,
    };
  }
  async function searchPage(query: string, offset: number): Promise<{ titles: MediaTitle[]; nextOffset: number | null }> {
    searchOffset(offset);
    if (typeof query !== 'string' || query.trim().length < 2) return { titles: [], nextOffset: null };
    const normalizedQuery = query.trim().replace(/\s+/gu, ' ');
    if (normalizedQuery.length > 200) throw new CatalogError('Please use a shorter anime title.', 400);
    const result = await request('anime', { q: normalizedQuery, fields: FIELDS, limit: String(SEARCH_PAGE_SIZE), offset: String(offset), nsfw: 'false' }, 2);
    const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
    const wanted = normalize(normalizedQuery);
    const exact = (title: MediaTitle) => normalize(title.title) === wanted || (title.anime?.englishTitle ? normalize(title.anime.englishTitle) === wanted : false);
    // Stable sorting retains MAL's order within each page's exact and nonexact groups.
    const titles = (result.data as MalObject[]).map(edge => object(edge.node)!).filter(publicTitle).slice(0, SEARCH_PAGE_SIZE).map(row => fromMal(row, true)).sort((a, b) => Number(exact(b)) - Number(exact(a)));
    return { titles, nextOffset: nextSearchOffset(result, normalizedQuery, offset) };
  }
  return {
    mode: 'live', provider: 'mal', configured: () => Boolean(credential), connection: () => connection,
    search: async query => (await searchPage(query, 0)).titles,
    searchPage,
    series: async id => seriesResolver.series(parseIds([id])[0]),
    titles: async ids => Promise.all(parseIds(ids).map(async id => fromMal(await detail(id), true))),
    hydrate: async ids => {
      const selected = parseIds(ids);
      const results = await Promise.allSettled(selected.map(async id => fromMal(await detail(id), true)));
      const titles: MediaTitle[] = [];
      const unavailableIds: string[] = [];
      let firstError: unknown;
      for (let index = 0; index < results.length; index++) {
        const result = results[index];
        if (result.status === 'fulfilled') titles.push(result.value);
        else {
          unavailableIds.push(selected[index]);
          if (!(result.reason instanceof CatalogError && result.reason.status === 404)) firstError ??= result.reason;
        }
      }
      if (!titles.length && firstError) throw firstError;
      return { titles, unavailableIds };
    },
    featured: async () => {
      if (!credential) return [];
      const result = await request('anime/ranking', { ranking_type: 'bypopularity', fields: FIELDS, limit: '6', nsfw: 'false' });
      return (result.data as MalObject[]).map(edge => object(edge.node)!).filter(publicTitle).slice(0, 6).map(row => fromMal(row, true));
    },
    recommend,
    candidates: async (seeds, type) => {
      const result = await recommend(seeds.map(title => title.id), type);
      return { titles: result.items.map(item => item.title), seeds: result.seeds, note: result.note ?? undefined };
    },
    close: () => {
      cache.clear();
      seriesResolver.clear();
      cacheBytes = 0;
      for (const job of waiting.splice(0)) {
        clearTimeout(job.timeout);
        job.reject(new CatalogError('The anime connection was closed. Please try again.', 503));
      }
    },
  };
}
