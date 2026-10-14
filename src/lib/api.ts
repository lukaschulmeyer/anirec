import type { MediaTitle, RankResult } from '../shared/types';

export const MAX_SELECTED_TITLES=8;

export interface RecommendationResponse extends RankResult {
  seeds: MediaTitle[];
  mode: 'live';
  catalogNote: string | null;
  candidateCount: number;
  recommendationsComplete?:boolean;
  warning?:string|null;

}
export interface CatalogStatus {
  mode:'live';label:string;provider:'MyAnimeList';
  configured?:boolean;
  connection?:string;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`,{...init,headers:{'Content-Type':'application/json',...init?.headers}}); }
  catch(error) { if(error instanceof Error&&error.name==='AbortError')throw error; throw new Error('The catalog could not be reached. Please try again.'); }
  let data;
  try { data = await response.json(); }
  catch(error) { if(error instanceof Error&&error.name==='AbortError')throw error; throw new Error('The catalog could not be reached. Please try again.'); }
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data as T;
}

export const titleFormat = (t: MediaTitle) => t.anime ? (!t.anime.format||t.anime.format==='unknown'?'Format unavailable':animeLabel(t.anime.format)) : t.type === 'movie' ? 'Movie' : 'TV show';
export const titleMetadata = (t: MediaTitle) => `${t.year ?? 'Year unavailable'} · ${titleFormat(t)}`;

/** Provider enum values are display labels, never inferred title characteristics. */
export function animeLabel(value:string|null|undefined):string {
  if(!value||value==='unknown')return 'Not available';
  const labels:Record<string,string>={tv:'TV series',movie:'Movie',ova:'OVA',ona:'ONA',special:'Special',tv_special:'TV special',music:'Music',
    finished_airing:'Finished airing',currently_airing:'Currently airing',not_yet_aired:'Not yet aired',
    light_novel:'Light novel',visual_novel:'Visual novel',web_manga:'Web manga',other:'Other',
    g:'G · All ages',pg:'PG · Children',pg_13:'PG-13 · Teens 13+',r:'R · 17+','r+':'R+ · Mild nudity',r_plus:'R+ · Mild nudity',rx:'Rx · Explicit'};
  return labels[value]??value.replace(/_/g,' ').replace(/^./,letter=>letter.toUpperCase());
}

// Session-only reuse keeps a card and its popup from requesting the same details twice.
const detailsCache=new Map<string,{title:MediaTitle;expires:number}>();
const pendingDetails=new Map<string,Promise<MediaTitle>>();
const seriesCache=new Map<string,{title:MediaTitle;expires:number}>();
const pendingSeries=new Map<string,Promise<MediaTitle>>();
const DETAIL_TTL=5*60*1000;

/** Compact hydration must not discard full metadata or an already loaded series. */
export function mergeTitleDetails(next:MediaTitle,current?:MediaTitle):MediaTitle {
  if(!current||current.id!==next.id||!next.anime||!current.anime)return next;
  const base=!next.anime.detailsLoaded&&current.anime.detailsLoaded?current:next;
  const series=next.anime.series??current.anime.series;
  return series?{...base,anime:{...base.anime!,series}}:base;
}

function rememberDetails(value:MediaTitle):MediaTitle {
  const title=mergeTitleDetails(value,cachedTitleDetails(value.id));
  if(title.anime&&!title.anime.detailsLoaded)return title;
  detailsCache.delete(title.id);
  detailsCache.set(title.id,{title,expires:Date.now()+DETAIL_TTL});
  while(detailsCache.size>120)detailsCache.delete(detailsCache.keys().next().value!);
  return title;
}

export function cachedTitleDetails(id:string):MediaTitle|undefined {
  const entry=detailsCache.get(id);
  if(entry&&entry.expires>Date.now())return entry.title;
  detailsCache.delete(id);
  return undefined;
}

function withCancellation<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T> {
  if(!signal)return promise;
  if(signal.aborted)return Promise.reject(signal.reason??new DOMException('Cancelled','AbortError'));
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason??new DOMException('Cancelled','AbortError'));
    signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}

function requestTitleDetails(ids:string[],partial:boolean):Promise<MediaTitle>[] {
  const unique=[...new Set(ids)];
  const missing=unique.filter(id=>!cachedTitleDetails(id)&&!pendingDetails.has(id));
  if(missing.length){
    // Shared requests survive one caller closing a popup; each caller still cancels its own updates.
    const batch=api<{titles:MediaTitle[]}>(`/titles?ids=${encodeURIComponent(missing.join(','))}${partial?'&partial=1':''}`);
    for(const id of missing){
      const request=batch.then(({titles})=>{
        const title=titles.find(value=>value.id===id);
        if(!title)throw new Error('Some title details are unavailable. Please try again.');
        return rememberDetails(title);
      }).finally(()=>pendingDetails.delete(id));
      pendingDetails.set(id,request);
    }
  }
  return unique.map(id=>{
    const cached=cachedTitleDetails(id);
    return cached?Promise.resolve(cached):pendingDetails.get(id)!;
  });
}

export function loadTitleDetails(ids:string[],signal?:AbortSignal):Promise<MediaTitle[]> {
  if(signal?.aborted)return Promise.reject(signal.reason??new DOMException('Cancelled','AbortError'));
  return withCancellation(Promise.all(requestTitleDetails(ids,false)),signal);
}

/** Candidate failures remain isolated, while selected-title restoration stays strict. */
export async function loadPartialTitleDetails(ids:string[],signal?:AbortSignal):Promise<{titles:MediaTitle[];unavailableIds:string[]}> {
  if(signal?.aborted)throw signal.reason??new DOMException('Cancelled','AbortError');
  const unique=[...new Set(ids)];
  const settled=await withCancellation(Promise.allSettled(requestTitleDetails(unique,true)),signal);
  const titles:MediaTitle[]=[];
  const unavailableIds:string[]=[];
  settled.forEach((result,index)=>{
    if(result.status==='fulfilled')titles.push(result.value);
    else unavailableIds.push(unique[index]);
  });
  return {titles,unavailableIds};
}

export function cachedTitleSeries(id:string):MediaTitle|undefined {
  const entry=seriesCache.get(id);
  if(entry&&entry.expires>Date.now())return mergeTitleDetails(cachedTitleDetails(id)??entry.title,entry.title);
  seriesCache.delete(id);
  return undefined;
}

/** Series requests are shared between popup visits, independently of basic title hydration. */
export function loadTitleSeries(id:string,signal?:AbortSignal,refresh=false):Promise<MediaTitle> {
  if(signal?.aborted)return Promise.reject(signal.reason??new DOMException('Cancelled','AbortError'));
  const cached=refresh?undefined:cachedTitleSeries(id);
  if(cached)return withCancellation(Promise.resolve(cached),signal);
  let request=pendingSeries.get(id);
  if(!request){
    request=api<{title:MediaTitle}>(`/series?id=${encodeURIComponent(id)}`).then(({title})=>{
      if(title?.id!==id||!title.anime?.series)throw new Error('Seasons and related movies are unavailable. Please try again.');
      const merged=rememberDetails(title);
      seriesCache.delete(id);
      seriesCache.set(id,{title:merged,expires:Date.now()+(title.anime.series.complete?DETAIL_TTL:30_000)});
      while(seriesCache.size>120)seriesCache.delete(seriesCache.keys().next().value!);
      return merged;
    }).finally(()=>pendingSeries.delete(id));
    pendingSeries.set(id,request);
  }
  return withCancellation(request,signal);
}

export function recsUrl(ids: string[], type = 'both') {
  return `/recs?${new URLSearchParams({picks:[...new Set(ids)].join(','),type})}`;
}

export function picksUrl(ids:string[],type='both') {
  const params=new URLSearchParams();
  if(ids.length)params.set('picks',[...new Set(ids)].join(','));
  if(type!=='both')params.set('type',type);
  return params.size?`/?${params}`:'/';
}
