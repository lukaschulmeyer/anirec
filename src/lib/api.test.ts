import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, cachedTitleDetails, cachedTitleSeries, loadPartialTitleDetails, loadTitleDetails, loadTitleSeries, mergeTitleDetails, MAX_SELECTED_TITLES, picksUrl, recsUrl, titleFormat, titleMetadata } from './api';
import type { MediaTitle } from '../shared/types';

afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});

describe('catalog API request failures and cancellation',()=>{
  it('preserves cancellation after headers arrive while the JSON body is still loading',async()=>{
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const response=new Response(new ReadableStream<Uint8Array>({start(controller){body=controller;}}),
      {headers:{'Content-Type':'application/json'}});
    const abort=new AbortController();
    const reason=new DOMException('Request superseded','AbortError');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));
    const pending=api('/search?q=Arrival',{signal:abort.signal});
    const rejected=expect(pending).rejects.toBe(reason);
    await vi.waitFor(()=>expect(response.bodyUsed).toBe(true));
    abort.abort(reason);
    body.error(reason);
    await rejected;
  });

  it('preserves cancellation before response headers arrive',async()=>{
    const reason=new DOMException('Request superseded','AbortError');
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(reason));
    await expect(api('/search?q=Arrival')).rejects.toBe(reason);
  });

  it('retains the readable connection error for an invalid JSON response',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('not JSON')));
    await expect(api('/status')).rejects.toThrow('The catalog could not be reached. Please try again.');
  });

  it('retains the readable connection error for a network failure',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('Network unavailable')));
    await expect(api('/status')).rejects.toThrow('The catalog could not be reached. Please try again.');
  });

  it('keeps the API error message when the server rejects a request',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:'Choose valid titles.'},{status:400})));
    await expect(api('/recommend')).rejects.toThrow('Choose valid titles.');
  });

  it('passes the cancellation signal and request body through without changing successful data',async()=>{
    const abort=new AbortController();
    const body=JSON.stringify({ids:['imdb:tt2543164'],type:'movie'});
    const fetch=vi.fn().mockResolvedValue(Response.json({items:[],note:'Limited evidence'}));
    vi.stubGlobal('fetch',fetch);
    await expect(api('/recommend',{method:'POST',body,signal:abort.signal})).resolves.toEqual({items:[],note:'Limited evidence'});
    expect(fetch).toHaveBeenCalledWith('/api/recommend',{method:'POST',body,signal:abort.signal,headers:{'Content-Type':'application/json'}});
  });
});

const anime=(id:string):MediaTitle=>({id,type:'tv',title:'Test anime',year:2024,posterUrl:null,overview:'A synopsis.',genres:['Adventure'],sources:[],traits:{},
  anime:{format:'ona',englishTitle:null,japaneseTitle:null,synonyms:[],startDate:null,endDate:null,status:'finished_airing',episodes:12,episodeMinutes:24,
    studios:[],communityScore:null,scoringUsers:null,ageRating:null,sourceMaterial:null,season:null,detailsLoaded:true}});

describe('anime detail reuse and cancellation',()=>{
  it('reuses a pending card request for its popup while allowing the card caller to cancel',async()=>{
    let complete!:(value:Response)=>void;
    const fetch=vi.fn().mockReturnValue(new Promise<Response>(resolve=>{complete=resolve;}));
    vi.stubGlobal('fetch',fetch);
    const abort=new AbortController();
    const cancelled=loadTitleDetails(['mal:910001'],abort.signal);
    const popup=loadTitleDetails(['mal:910001']);
    const cancellation=expect(cancelled).rejects.toMatchObject({name:'AbortError'});
    abort.abort();
    await cancellation;
    complete(Response.json({titles:[anime('mal:910001')]}));
    await expect(popup).resolves.toEqual([anime('mal:910001')]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(loadTitleDetails(['mal:910001'])).resolves.toEqual([anime('mal:910001')]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries missing title details instead of caching an empty success',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(Response.json({titles:[]})).mockResolvedValueOnce(Response.json({titles:[anime('mal:910002')]}));
    vi.stubGlobal('fetch',fetch);
    await expect(loadTitleDetails(['mal:910002'])).rejects.toThrow('Some title details are unavailable');
    expect(cachedTitleDetails('mal:910002')).toBeUndefined();
    await expect(loadTitleDetails(['mal:910002'])).resolves.toEqual([anime('mal:910002')]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refreshes stale metadata and preserves the actual anime format',async()=>{
    vi.useFakeTimers();
    const fetch=vi.fn().mockImplementation(()=>Promise.resolve(Response.json({titles:[anime('mal:910003')]})));
    vi.stubGlobal('fetch',fetch);
    await loadTitleDetails(['mal:910003']);
    expect(titleMetadata(anime('mal:910003'))).toBe('2024 · ONA');
    vi.advanceTimersByTime(5*60*1000+1);
    expect(cachedTitleDetails('mal:910003')).toBeUndefined();
    await loadTitleDetails(['mal:910003']);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps successful candidate metadata when another candidate is unavailable',async()=>{
    const fetch=vi.fn().mockResolvedValue(Response.json({titles:[anime('mal:910004')],unavailableIds:['mal:910005']}));
    vi.stubGlobal('fetch',fetch);
    await expect(loadPartialTitleDetails(['mal:910004','mal:910005'])).resolves.toEqual({titles:[anime('mal:910004')],unavailableIds:['mal:910005']});
    expect(fetch.mock.calls[0][0]).toContain('&partial=1');
    expect(cachedTitleDetails('mal:910004')).toEqual(anime('mal:910004'));
    expect(cachedTitleDetails('mal:910005')).toBeUndefined();
  });

  it('fails strict selected-title restoration if any selected title is absent',async()=>{
    const fetch=vi.fn().mockResolvedValue(Response.json({titles:[anime('mal:910006')]}));
    vi.stubGlobal('fetch',fetch);
    await expect(loadTitleDetails(['mal:910006','mal:910007'])).rejects.toThrow('Some title details are unavailable');
    expect(fetch.mock.calls[0][0]).not.toContain('partial');
  });

  it('cancels a caller before dispatching any detail request',async()=>{
    const fetch=vi.fn();
    vi.stubGlobal('fetch',fetch);
    const abort=new AbortController();
    abort.abort();
    await expect(loadPartialTitleDetails(['mal:910008'],abort.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('anime selection links and formats',()=>{
  it('retains the chosen output type and distinct selections in results and edit links',()=>{
    const ids=['mal:1','mal:20','mal:1'];
    for(const url of [recsUrl(ids,'movie'),picksUrl(ids,'movie')]){
      const parsed=new URL(url,'https://example.test');
      expect(parsed.searchParams.get('picks')).toBe('mal:1,mal:20');
      expect(parsed.searchParams.get('type')).toBe('movie');
    }
    expect(picksUrl([])).toBe('/');
    expect(MAX_SELECTED_TITLES).toBe(8);
  });

  it('does not describe an OVA, ONA, special, music title or unknown format as TV',()=>{
    const title=anime('mal:1');
    for(const [format,label] of [['ova','OVA'],['ona','ONA'],['special','Special'],['tv_special','TV special'],['music','Music'],['unknown','Format unavailable']]){
      expect(titleFormat({...title,anime:{...title.anime!,format}})).toBe(label);
    }
  });
});

describe('lazy series details',()=>{
  const withSeries=(id:string,complete=true):MediaTitle=>{
    const title=anime(id);
    return{...title,anime:{...title.anime!,series:{id,installments:[title,anime(`${id}2`)],relatedMovies:[],complete}}};
  };

  it('loads series separately even when full basic metadata is already cached, then reuses it',async()=>{
    const id='mal:920001';
    const fetch=vi.fn().mockResolvedValueOnce(Response.json({titles:[anime(id)]})).mockResolvedValueOnce(Response.json({title:withSeries(id)}));
    vi.stubGlobal('fetch',fetch);
    await loadTitleDetails([id]);
    await expect(loadTitleSeries(id)).resolves.toEqual(withSeries(id));
    expect(fetch.mock.calls[1][0]).toBe('/api/series?id=mal%3A920001');
    await loadTitleSeries(id);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cachedTitleSeries(id)?.anime?.series?.installments).toHaveLength(2);
  });

  it('deduplicates pending popup loads while allowing an individual caller to cancel',async()=>{
    let resolve!:(value:Response)=>void;
    const fetch=vi.fn().mockReturnValue(new Promise<Response>(done=>{resolve=done;}));
    vi.stubGlobal('fetch',fetch);
    const abort=new AbortController();
    const first=loadTitleSeries('mal:920002',abort.signal);
    const second=loadTitleSeries('mal:920002');
    const cancelled=expect(first).rejects.toMatchObject({name:'AbortError'});
    abort.abort();await cancelled;
    resolve(Response.json({title:withSeries('mal:920002')}));
    await expect(second).resolves.toEqual(withSeries('mal:920002'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries failed requests and permits an explicit refresh of a partial series',async()=>{
    const id='mal:920003';
    const fetch=vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(Response.json({title:withSeries(id,false)})).mockResolvedValueOnce(Response.json({title:withSeries(id,true)}));
    vi.stubGlobal('fetch',fetch);
    await expect(loadTitleSeries(id)).rejects.toThrow('could not be reached');
    expect(cachedTitleSeries(id)).toBeUndefined();
    await expect(loadTitleSeries(id)).resolves.toMatchObject({anime:{series:{complete:false}}});
    await expect(loadTitleSeries(id,undefined,true)).resolves.toMatchObject({anime:{series:{complete:true}}});
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('rejects a response that replaces the requested title identity',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({title:withSeries('mal:929999')})));
    await expect(loadTitleSeries('mal:920004')).rejects.toThrow('Seasons and related movies are unavailable');
    expect(cachedTitleSeries('mal:920004')).toBeUndefined();
  });

  it('preserves loaded series and full metadata during compact or ordinary hydration',()=>{
    const current=withSeries('mal:920005');
    const compact={...anime(current.id),overview:'',anime:{...anime(current.id).anime!,detailsLoaded:false}};
    expect(mergeTitleDetails(compact,current)).toEqual(current);
    const updated={...anime(current.id),overview:'Updated synopsis.'};
    const merged=mergeTitleDetails(updated,current);
    expect(merged.overview).toBe('Updated synopsis.');
    expect(merged.anime?.series).toEqual(current.anime?.series);
    expect(mergeTitleDetails(anime('mal:920006'),current).anime?.series).toBeUndefined();
  });
});
