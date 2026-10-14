import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle, Search, X } from 'lucide-react';
import type { MediaTitle, OutputType } from '../shared/types';
import { api, MAX_SELECTED_TITLES, titleMetadata } from '../lib/api';
import { Poster } from './Poster';
import { SelectedTitles } from './SelectedTitles';
import { FormatTabs } from './FormatTabs';
import { useTitleLanguage } from '../lib/title-language-context';

interface Props {
  selected:MediaTitle[];onSelected:(titles:MediaTitle[])=>void;
  type:OutputType;onType:(type:OutputType)=>void;onSubmit:()=>void;
  compact?:boolean;autoFocus?:boolean;unavailable?:boolean;
}

interface SearchPage {titles:MediaTitle[];nextOffset?:number|null}
export interface SearchPageState {
  query:string;titles:MediaTitle[];nextOffset:number|null;
  loading:boolean;loadingMore:boolean;error:string;moreError:string;
}
const emptyPage=(query=''):SearchPageState=>({query,titles:[],nextOffset:null,loading:false,loadingMore:false,error:'',moreError:''});
type PageFetcher=(path:string,signal:AbortSignal)=>Promise<SearchPage>;

/** One query owns its requests and cursor. A cancelled query can never publish another page. */
export function createSearchSession(query:string,publish:(state:SearchPageState)=>void,fetchPage:PageFetcher=(path,signal)=>api<SearchPage>(path,{signal})) {
  let state=emptyPage(query);
  let request:AbortController|null=null;
  let cancelled=false;
  const update=(changes:Partial<SearchPageState>)=>{state={...state,...changes};if(!cancelled)publish(state);};
  const load=async(offset?:number)=>{
    if(cancelled||request)return;
    const controller=new AbortController();
    request=controller;
    const more=offset!==undefined;
    update(more?{loadingMore:true,moreError:''}:{loading:true,error:''});
    try{
      const page=await fetchPage(`/search?q=${encodeURIComponent(query)}${more?`&offset=${offset}`:''}`,controller.signal);
      if(cancelled||controller.signal.aborted)return;
      const titles=more?[...state.titles]:[];
      const seen=new Set(titles.map(title=>title.id));
      for(const title of page.titles){if(!seen.has(title.id)){seen.add(title.id);titles.push(title);}}
      const nextOffset=typeof page.nextOffset==='number'&&Number.isInteger(page.nextOffset)&&page.nextOffset>(offset??0)?page.nextOffset:null;
      update({titles,nextOffset,loading:false,loadingMore:false,error:'',moreError:''});
    }catch(error){
      if(cancelled||controller.signal.aborted)return;
      const message=error instanceof Error?error.message:'The catalog could not be reached. Please try again.';
      update(more?{loadingMore:false,moreError:message}:{loading:false,error:message});
    }finally{if(request===controller)request=null;}
  };
  return {
    start:()=>load(),
    more:()=>state.nextOffset!==null?load(state.nextOffset):Promise.resolve(),
    cancel:()=>{cancelled=true;request?.abort();},
  };
}

export function SearchComposer({selected,onSelected,type,onType,onSubmit,compact=false,autoFocus=false,unavailable=false}:Props) {
  const {titleName}=useTitleLanguage();
  const [query,setQuery]=useState('');
  const [page,setPage]=useState<SearchPageState>(emptyPage);
  const [open,setOpen]=useState(false);
  const [active,setActive]=useState(0);
  const [retry,setRetry]=useState(0);
  const input=useRef<HTMLInputElement>(null);
  const dropdown=useRef<HTMLDivElement>(null);
  const preservedScroll=useRef<number|null>(null);
  const restoreInputFocus=useRef(false);
  const scrollActiveOption=useRef(false);
  const session=useRef<ReturnType<typeof createSearchSession>|null>(null);
  const resultId=useId();
  const normalizedQuery=query.trim().replace(/\s+/gu,' ');
  const selectedIds=new Set(selected.map(t=>t.id));
  const selectionKey=[...selectedIds].join(',');
  const atLimit=selectedIds.size>=MAX_SELECTED_TITLES;
  // Hide the previous query synchronously, before its effect cleanup runs.
  const currentPage=page.query===normalizedQuery?page:{...emptyPage(normalizedQuery),loading:true};
  const {loading,error,loadingMore,moreError,nextOffset}=currentPage;
  const results=currentPage.titles.filter(title=>!selectedIds.has(title.id));
  const activeIndex=Math.min(active,Math.max(0,results.length-1));
  useEffect(()=>{
    preservedScroll.current=null;
    restoreInputFocus.current=false;
    scrollActiveOption.current=false;
    setActive(0);
    if(normalizedQuery.length<2||unavailable||atLimit) {setPage(emptyPage(normalizedQuery));return;}
    setPage({...emptyPage(normalizedQuery),loading:true});
    let wasLoadingMore=false;
    const nextSession=createSearchSession(normalizedQuery,next=>{
      if(wasLoadingMore&&!next.loadingMore){
        preservedScroll.current=dropdown.current?.scrollTop??null;
        restoreInputFocus.current=next.nextOffset===null&&Boolean(dropdown.current?.querySelector('.search-more-button')===document.activeElement);
      }
      wasLoadingMore=next.loadingMore;
      setPage(next);
    });
    session.current=nextSession;
    const timer=window.setTimeout(()=>{void nextSession.start();},150);
    return()=>{window.clearTimeout(timer);nextSession.cancel();if(session.current===nextSession)session.current=null;};
  },[normalizedQuery,retry,unavailable,atLimit,selectionKey]);
  useLayoutEffect(()=>{
    if(preservedScroll.current!==null&&dropdown.current){dropdown.current.scrollTop=preservedScroll.current;preservedScroll.current=null;}
    if(restoreInputFocus.current){input.current?.focus({preventScroll:true});restoreInputFocus.current=false;}
  },[page]);
  useEffect(()=>{if(autoFocus)input.current?.focus();},[autoFocus]);
  useEffect(()=>{
    if(open&&scrollActiveOption.current){
      document.getElementById(`${resultId}-${activeIndex}`)?.scrollIntoView({block:'nearest'});
      scrollActiveOption.current=false;
    }
  },[activeIndex,open,resultId]);
  const changeQuery=(value:string)=>{
    if(value.trim().replace(/\s+/gu,' ')!==normalizedQuery){session.current?.cancel();preservedScroll.current=null;setActive(0);}
    setQuery(value);
  };
  const add=(title:MediaTitle)=>{
    if(atLimit)return;
    session.current?.cancel();
    if(!selected.some(t=>t.id===title.id))onSelected([...selected,title]);
    changeQuery('');setPage(emptyPage());setOpen(false);input.current?.focus();
  };
  const expanded=open&&normalizedQuery.length>=2&&!unavailable&&!atLimit;
  const validSelection=selectedIds.size>0&&selectedIds.size<=MAX_SELECTED_TITLES;
  return <form className={`search-composer ${compact?'compact':''}`} onSubmit={event=>{event.preventDefault();if(validSelection&&!unavailable)onSubmit();}}>
    <div className="search-wrap" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();input.current?.focus({preventScroll:true});setOpen(false);}}}>
      <div className={`search-field ${expanded?'searching':''}`}>
        <Search size={25} strokeWidth={1.9} aria-hidden="true"/>
        <input ref={input} role="combobox" aria-label="Search anime" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded&&results.length?resultId:undefined} aria-activedescendant={expanded&&results[activeIndex]?`${resultId}-${activeIndex}`:undefined}
          autoComplete="off" spellCheck={false} maxLength={200} placeholder={atLimit?'Your eight picks are ready':'Search an anime you love'} disabled={unavailable||atLimit} value={query} onFocus={()=>setOpen(true)} onChange={e=>{changeQuery(e.target.value);setOpen(true);}}
          onKeyDown={e=>{
            if(e.key==='ArrowDown'&&results.length){e.preventDefault();scrollActiveOption.current=true;setOpen(true);setActive(expanded?(activeIndex+1)%results.length:0);}
            if(e.key==='ArrowUp'&&results.length){e.preventDefault();scrollActiveOption.current=true;setOpen(true);setActive(expanded?(activeIndex-1+results.length)%results.length:results.length-1);}
            if(e.key==='Escape'){e.preventDefault();setOpen(false);}
            if(e.key==='Enter'&&expanded){e.preventDefault();if(results[activeIndex]&&!loading)add(results[activeIndex]);}
          }}/>
        {loading&&<LoaderCircle className="spin" size={19} aria-label="Searching"/>}
        {query&&<button type="button" className="icon-button" aria-label="Clear search" onClick={()=>{changeQuery('');input.current?.focus();}}><X size={19}/></button>}
      </div>
      {expanded&&<div className="search-dropdown" ref={dropdown}>
        <div className="search-caption">Anime on MyAnimeList<span>Select to add</span></div>
        {loading?<div className="search-message" role="status">Finding your title…</div>:error?<div className="search-message" role="alert">{error} <button type="button" className="text-button" onClick={()=>setRetry(v=>v+1)}>Try again</button></div>:results.length===0?<div className="search-message">No unselected matches for “{query}”.<small>Try the original title or another spelling. Some alternate names may not appear in search.</small></div>:
          <ul id={resultId} role="listbox" aria-label="Matching titles">{results.map((title,index)=><li id={`${resultId}-${index}`} role="option" aria-selected={activeIndex===index} key={title.id} className={activeIndex===index?'active':''} onMouseMove={()=>{scrollActiveOption.current=false;setActive(index);}} onMouseDown={e=>e.preventDefault()} onClick={()=>add(title)}>
            <Poster title={title} eager thumbnail/><span className="search-title"><strong>{titleName(title)}</strong><small>{titleMetadata(title)}</small></span><span className="add-sign" aria-hidden="true">+</span>
          </li>)}</ul>}
        {!loading&&!error&&nextOffset!==null&&<div className="search-pagination">
          {moreError&&<p className="search-more-error" role="alert">{moreError} Your previous results are still available.</p>}
          <button type="button" className="search-more-button" aria-disabled={loadingMore} aria-busy={loadingMore} onClick={()=>{if(!loadingMore)void session.current?.more();}}>{loadingMore?'Loading…':moreError?'Try loading more':'Load 10 more'}</button>
          <small>More results in batches of 10.</small>
        </div>}
        {!loading&&!error&&currentPage.titles.length>0&&<p className="search-page-status sr-only" role="status">{loadingMore?'Loading more results…':`${results.length} unselected results loaded.${nextOffset===null?' End of results.':''}`}</p>}
      </div>}
    </div>
    <SelectedTitles titles={selected} onRemove={id=>{session.current?.cancel();onSelected(selected.filter(t=>t.id!==id));}}/>
    <div className="search-actions"><FormatTabs value={type} onChange={onType}/><button type="submit" className="primary-button" disabled={!validSelection||unavailable}>Get recommendations <ArrowUpRight size={19}/></button></div>
    {atLimit?<p className="search-helper" role="status">Eight picks selected. Remove one to add another.</p>:!compact&&<p className="search-helper">One favorite or a few. Follow the overlap.</p>}
    <span className="sr-only" role="status">{selected.length?`${selected.length} ${selected.length===1?'title':'titles'} selected.`:''}</span>
  </form>;
}
