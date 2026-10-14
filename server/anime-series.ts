import type { AnimeSeries, MediaTitle } from '../src/shared/types';
import { CatalogError } from './catalog-error';

export interface AnimeRelation { type: string; title: MediaTitle }
export interface AnimeRelationNode { title: MediaTitle; relations: AnimeRelation[]; summaryEvidence?: boolean }
// Generic specials include promotional prologues and extras. TV specials can be
// main installments (for example the Attack on Titan finale), subject to recap exclusions.
const EPISODIC = new Set(['tv', 'ona', 'ova', 'tv_special']);
const CONTINUITY = new Set(['prequel', 'sequel']);
const MOVIE_RELATIONS = new Set(['prequel', 'sequel', 'summary', 'side_story', 'spin_off', 'alternative_version']);
const MAX_NODES = 80;
const TTL = 10 * 60_000;

export function beforeAnimeDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  if (!Number.isFinite(deadline)) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CatalogError('Verifying these anime connections took too long. Please try again; completed lookups are cached.', 503, 2)), Math.max(0, deadline - Date.now()));
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

function order(a: MediaTitle, b: MediaTitle): number {
  return (a.anime?.startDate ?? '9999').localeCompare(b.anime?.startDate ?? '9999') || Number(a.id.slice(4)) - Number(b.id.slice(4));
}
function bare(title: MediaTitle): MediaTitle {
  if (!title.anime?.series) return title;
  const { series: _series, ...anime } = title.anime;
  return { ...title, anime };
}
function episodic(title: MediaTitle): boolean { return EPISODIC.has(title.anime?.format ?? ''); }
function traversable(title: MediaTitle): boolean { return episodic(title) || title.anime?.format === 'movie'; }
function summary(node: AnimeRelationNode): boolean { return node.summaryEvidence === true || node.relations.some(edge => edge.type === 'full_story'); }

/** Official relationships establish continuity. Titles, years and ratings never create edges. */
export function createAnimeSeriesResolver(load: (id: string, deadline: number) => Promise<AnimeRelationNode>) {
  const identities = new Map<string, { at: number; title: MediaTitle }>();
  const groups = new Map<string, { at: number; series: AnimeSeries }>();
  const pending = new Map<string, Promise<MediaTitle>>();
  const sizes = new WeakMap<object, Map<string, number>>();
  function cached<T extends { at: number }>(map: Map<string, T>, id: string): T | undefined {
    const value = map.get(id);
    if (value && Date.now() - value.at < TTL) return value;
    map.delete(id);
    sizes.get(map)?.delete(id);
    return undefined;
  }
  function put<T>(map: Map<string, T>, id: string, value: T): void {
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (bytes > 1024 * 1024) return;
    let weights = sizes.get(map);
    if (!weights) { weights = new Map(); sizes.set(map, weights); }
    map.delete(id);
    weights.delete(id);
    let total = [...weights.values()].reduce((sum, size) => sum + size, 0);
    while (map.size >= 400 || total + bytes > 2 * 1024 * 1024) {
      const oldest = map.keys().next().value!;
      total -= weights.get(oldest) ?? 0;
      weights.delete(oldest);
      map.delete(oldest);
    }
    map.set(id, value);
    weights.set(id, bytes);
  }
  async function walk(id: string, full: boolean, deadline: number): Promise<Map<string, AnimeRelationNode>> {
    const nodes = new Map<string, AnimeRelationNode>();
    const todo = [id];
    const excluded = new Set<string>();
    while (todo.length) {
      const next = todo.shift()!;
      if (nodes.has(next) || excluded.has(next)) continue;
      if (Date.now() >= deadline) throw new CatalogError('Verifying this show took too long. Please try again; completed lookups are cached.', 503, 2);
      if (nodes.size >= MAX_NODES) throw new CatalogError('This show has more linked releases than can be verified in one request. Please choose another title.', 503, 5);
      let node: AnimeRelationNode;
      try { node = await beforeAnimeDeadline(load(next, deadline), deadline); }
      catch (error) {
        if (error instanceof CatalogError && error.status === 404 && next !== id) throw new CatalogError('A linked anime release is unavailable, so this show could not be verified. Please try again later.', 503, 5);
        throw error;
      }
      nodes.set(next, node);
      if (next !== id && node.title.anime?.format === 'unknown') throw new CatalogError('A linked anime release has no known format, so this show could not be verified. Please try again later.', 503, 5);
      for (const edge of node.relations) if (edge.type === 'summary') excluded.add(edge.title.id);
      if (summary(node) || !traversable(node.title)) continue;
      for (const edge of node.relations) {
        if ((full ? CONTINUITY.has(edge.type) : edge.type === 'prequel') && (traversable(edge.title) || edge.title.anime?.format === 'unknown') && !excluded.has(edge.title.id)) todo.push(edge.title.id);
      }
    }
    // A node discovered as a summary after another edge queued it is still excluded.
    for (const node of nodes.values()) if (summary(node)) excluded.add(node.title.id);
    for (const excludedId of excluded) if (excludedId !== id) nodes.delete(excludedId);
    if (excluded.has(id)) nodes.set(id, { ...nodes.get(id)!, summaryEvidence: true });
    for (const node of nodes.values()) {
      if (summary(node) || !traversable(node.title)) continue;
      for (const edge of node.relations) {
        if (!(full ? CONTINUITY.has(edge.type) : edge.type === 'prequel') || !nodes.has(edge.title.id)) continue;
        const neighbor = nodes.get(edge.title.id)!;
        if (summary(neighbor) || !traversable(neighbor.title)) continue;
        const reverse = edge.type === 'prequel' ? 'sequel' : 'prequel';
        if (!neighbor.relations.some(back => back.type === reverse && back.title.id === node.title.id)) {
          throw new CatalogError('MyAnimeList returned inconsistent show relationships. Please try again later.', 503, 5);
        }
      }
    }
    return nodes;
  }
  function root(nodes: Map<string, AnimeRelationNode>, requested: string): MediaTitle {
    const first = nodes.get(requested)!;
    if (!episodic(first.title) || summary(first)) return bare(first.title);
    const main = [...nodes.values()].filter(node => episodic(node.title) && !summary(node));
    // A film before the first episodic entry does not become the show's root.
    // Follow movie bridges when testing whether an earlier episodic entry exists.
    function hasEarlierEpisode(node: AnimeRelationNode): boolean {
      const todo = node.relations.filter(edge => edge.type === 'prequel').map(edge => edge.title.id);
      const visited = new Set<string>();
      while (todo.length) {
        const id = todo.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const earlier = nodes.get(id);
        if (!earlier || summary(earlier)) continue;
        if (episodic(earlier.title)) return true;
        if (earlier.title.anime?.format === 'movie') todo.push(...earlier.relations.filter(edge => edge.type === 'prequel').map(edge => edge.title.id));
      }
      return false;
    }
    const roots = main.filter(node => !hasEarlierEpisode(node));
    if (roots.length > 1) throw new CatalogError('MyAnimeList links several independent shows to this release, so its show identity could not be verified. Please choose another title.', 503, 5);
    if (!roots.length && main.length) throw new CatalogError('MyAnimeList returned a cycle in the show relationships. Please try again later.', 503, 5);
    return bare(roots[0]?.title ?? first.title);
  }
  async function canonical(id: string, deadline = Date.now() + 24_000): Promise<MediaTitle> {
    const hit = cached(identities, id);
    if (hit) return hit.title;
    if (pending.has(id)) return beforeAnimeDeadline(pending.get(id)!, deadline);
    const promise = (async () => {
      const nodes = await walk(id, false, deadline);
      const title = root(nodes, id);
      // Only the requested ancestry is proven; do not assign unrelated graph nodes.
      put(identities, id, { at: Date.now(), title });
      return title;
    })();
    pending.set(id, promise);
    try { return await promise; } finally { pending.delete(id); }
  }
  async function series(id: string, deadline = Date.now() + 24_000): Promise<MediaTitle> {
    const requested = (await beforeAnimeDeadline(load(id, deadline), deadline)).title;
    if (!episodic(requested)) return bare(requested);
    const canonicalTitle = await canonical(id, deadline);
    const hit = cached(groups, canonicalTitle.id);
    if (hit) return { ...bare(requested), anime: { ...requested.anime!, series: hit.series } };
    const nodes = await walk(canonicalTitle.id, true, deadline);
    const actualRoot = root(nodes, canonicalTitle.id);
    // An asymmetric provider graph cannot silently change the previously resolved identity.
    if (actualRoot.id !== canonicalTitle.id || !nodes.has(id)) throw new CatalogError('MyAnimeList returned inconsistent show relationships. Please try again later.', 503, 5);
    const standalone = summary(nodes.get(id)!);
    const installments = (standalone ? [requested] : [...nodes.values()].filter(node => episodic(node.title) && !summary(node)).map(node => bare(node.title))).sort(order);
    const films = new Map<string, MediaTitle>();
    for (const node of nodes.values()) {
      if (node.title.anime?.format === 'movie') films.set(node.title.id, bare(node.title));
      for (const edge of node.relations) if (MOVIE_RELATIONS.has(edge.type) && edge.title.anime?.format === 'movie') films.set(edge.title.id, bare(edge.title));
    }
    const value: AnimeSeries = { id: canonicalTitle.id, installments, relatedMovies: [...films.values()].sort(order), complete: true };
    put(groups, canonicalTitle.id, { at: Date.now(), series: value });
    for (const title of installments) put(identities, title.id, { at: Date.now(), title: canonicalTitle });
    return { ...bare(requested), anime: { ...requested.anime!, series: value } };
  }
  return { canonical, series, clear: () => { identities.clear(); groups.clear(); pending.clear(); sizes.delete(identities); sizes.delete(groups); } };
}
