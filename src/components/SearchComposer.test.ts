import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MediaTitle } from '../shared/types';
import { SearchComposer, createSearchSession, type SearchPageState } from './SearchComposer';

const title=(id:number):MediaTitle=>({id:`mal:${id}`,type:'tv',title:`Anime ${id}`,year:2024,posterUrl:null,overview:'',genres:[],sources:[],traits:{}});
const render=(count:number,unavailable=false)=>renderToStaticMarkup(createElement(SearchComposer,{
  selected:Array.from({length:count},(_,index)=>title(index+1)),onSelected:()=>{},type:'both',onType:()=>{},onSubmit:()=>{},unavailable,
}));

describe('anime selection controls',()=>{
  it('requires a selection before requesting recommendations',()=>{
    expect(render(0)).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(render(1)).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it('allows eight selections and stops searching for a ninth while retaining removals',()=>{
    const html=render(8);
    expect(html).toContain('Eight picks selected. Remove one to add another.');
    expect(html).toMatch(/<input[^>]*role="combobox"[^>]*disabled=""/);
    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html.match(/aria-label="Remove Anime /g)).toHaveLength(8);
  });

  it('disables unavailable search without exposing configuration steps',()=>{
    const html=render(1,true);
    expect(html).toMatch(/<input[^>]*role="combobox"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).not.toMatch(/Client ID|API key|\.env/);
  });
});

describe('explicit search pagination',()=>{
  const batch=(start:number,count=10)=>Array.from({length:count},(_,index)=>title(start+index));
  const deferred=<T>()=>{
    let resolve!:(value:T)=>void;
    let reject!:(reason:Error)=>void;
    const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});
    return{promise,resolve,reject};
  };

  it('loads one batch at a time, preserves provider order, deduplicates IDs and accepts a short final page',async()=>{
    const fetchPage=vi.fn()
      .mockResolvedValueOnce({titles:batch(1),nextOffset:10})
      .mockResolvedValueOnce({titles:[title(10),...batch(11,9)],nextOffset:20})
      .mockResolvedValueOnce({titles:batch(20,3),nextOffset:null});
    const states:SearchPageState[]=[];
    const session=createSearchSession('Some anime',state=>states.push(state),fetchPage);
    await session.start();
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.titles).toHaveLength(10);
    expect(fetchPage.mock.calls[0][0]).toBe('/search?q=Some%20anime');
    await session.more();
    expect(fetchPage.mock.calls[1][0]).toBe('/search?q=Some%20anime&offset=10');
    expect(states.at(-1)?.titles.map(item=>item.id)).toEqual(batch(1,19).map(item=>item.id));
    await session.more();
    expect(fetchPage.mock.calls[2][0]).toBe('/search?q=Some%20anime&offset=20');
    expect(states.at(-1)?.titles.map(item=>item.id)).toEqual(batch(1,22).map(item=>item.id));
    expect(states.at(-1)?.nextOffset).toBeNull();
    await session.more();
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('keeps existing results visible while loading more and ignores duplicate load clicks',async()=>{
    const pending=deferred<{titles:MediaTitle[];nextOffset:null}>();
    const fetchPage=vi.fn().mockResolvedValueOnce({titles:batch(1),nextOffset:10}).mockReturnValueOnce(pending.promise);
    const states:SearchPageState[]=[];
    const session=createSearchSession('anime',state=>states.push(state),fetchPage);
    await session.start();
    const firstClick=session.more();
    await session.more();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toMatchObject({titles:batch(1),loading:false,loadingMore:true,nextOffset:10});
    pending.resolve({titles:batch(11),nextOffset:null});
    await firstClick;
    expect(states.at(-1)).toMatchObject({loadingMore:false,nextOffset:null});
    expect(states.at(-1)?.titles).toHaveLength(20);
  });

  it('retains previous pages and the failed cursor, then retries that cursor successfully',async()=>{
    const fetchPage=vi.fn()
      .mockResolvedValueOnce({titles:batch(1),nextOffset:10})
      .mockRejectedValueOnce(new Error('Service unavailable'))
      .mockResolvedValueOnce({titles:batch(11,4),nextOffset:null});
    const states:SearchPageState[]=[];
    const session=createSearchSession('anime',state=>states.push(state),fetchPage);
    await session.start();
    await session.more();
    expect(states.at(-1)).toMatchObject({titles:batch(1),error:'',moreError:'Service unavailable',loadingMore:false,nextOffset:10});
    await session.more();
    expect(fetchPage.mock.calls[1][0]).toBe(fetchPage.mock.calls[2][0]);
    expect(states.at(-1)).toMatchObject({moreError:'',nextOffset:null});
    expect(states.at(-1)?.titles).toHaveLength(14);
  });

  it('aborts an old query and ignores its late response even when the transport does not honor abort',async()=>{
    const oldPage=deferred<{titles:MediaTitle[];nextOffset:number}>();
    const fetchOld=vi.fn().mockReturnValue(oldPage.promise);
    const states:SearchPageState[]=[];
    const oldSession=createSearchSession('old query',state=>states.push(state),fetchOld);
    const pending=oldSession.start();
    oldSession.cancel();
    expect((fetchOld.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
    const fresh=createSearchSession('new query',state=>states.push(state),async()=>({titles:[title(99)],nextOffset:null}));
    await fresh.start();
    const before=states.length;
    oldPage.resolve({titles:batch(1),nextOffset:10});
    await pending;
    expect(states).toHaveLength(before);
    expect(states.at(-1)).toMatchObject({query:'new query',titles:[title(99)]});
  });

  it('cancels a pending extra page and suppresses its late failure',async()=>{
    const pending=deferred<{titles:MediaTitle[]}>();
    const fetchPage=vi.fn().mockResolvedValueOnce({titles:batch(1),nextOffset:10}).mockReturnValueOnce(pending.promise);
    const states:SearchPageState[]=[];
    const session=createSearchSession('anime',state=>states.push(state),fetchPage);
    await session.start();
    const loading=session.more();
    session.cancel();
    const before=states.length;
    expect((fetchPage.mock.calls[1][1] as AbortSignal).aborted).toBe(true);
    pending.reject(new Error('Late network failure'));
    await loading;
    await session.more();
    expect(states).toHaveLength(before);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it.each([undefined,null,0,-10])('treats absent or nonadvancing pagination (%s) as the end',async nextOffset=>{
    const fetchPage=vi.fn().mockResolvedValue({titles:batch(1),nextOffset});
    const states:SearchPageState[]=[];
    const session=createSearchSession('anime',state=>states.push(state),fetchPage);
    await session.start();
    await session.more();
    expect(states.at(-1)?.nextOffset).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
