import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Plus, RefreshCw } from 'lucide-react';
import type { MediaTitle, OutputType, RankedTitle } from '../shared/types';
import { api, loadPartialTitleDetails, MAX_SELECTED_TITLES, mergeTitleDetails, titleFormat, type RecommendationResponse, type CatalogStatus } from '../lib/api';
import { Poster } from '../components/Poster';
import { FormatTabs } from '../components/FormatTabs';
import { SelectedTitles } from '../components/SelectedTitles';
import { SearchComposer } from '../components/SearchComposer';
import { useTitleLanguage } from '../lib/title-language-context';

interface Props { ids:string[];type:OutputType;initialSelection:MediaTitle[];onEdit:()=>void;onChange:(ids:string[],type:OutputType)=>void;onLoaded:(t:MediaTitle[])=>void;onOpen:(t:RankedTitle)=>void;status:CatalogStatus|null }

export interface RecommendationPagination {snapshot:string;visibleCount:number}
export function recommendationPagination(state:RecommendationPagination,action:{type:'reset'|'more';snapshot:string}):RecommendationPagination {
  if(action.type==='reset')return{snapshot:action.snapshot,visibleCount:10};
  return{snapshot:action.snapshot,visibleCount:(state.snapshot===action.snapshot?state.visibleCount:10)+10};
}

export function visibleMetadataIds(items:RankedTitle[],visibleCount:number):string[] {
  return [...new Set(items.slice(0,visibleCount).filter(item=>item.title.anime&&!item.title.anime.detailsLoaded).map(item=>item.title.id))];
}

export function AddTitleButton({titles,loading,onClick}:{titles:MediaTitle[];loading:boolean;onClick:()=>void}) {
  const count=new Set(titles.map(title=>title.id)).size;
  return <button className="add-title" onClick={onClick} disabled={loading||count>=MAX_SELECTED_TITLES}><Plus size={17}/> Add a title</button>;
}

export function RecommendationCollection({data,loading,metadataError,visibleCount,onLoadMore,onOpen,onEdit}:{data:RecommendationResponse|null;loading:boolean;metadataError:boolean;visibleCount:number;onLoadMore:()=>void;onOpen:(item:RankedTitle)=>void;onEdit:()=>void}) {
  const {titleName}=useTitleLanguage();
  const items=data?.items.slice(0,visibleCount)??[];
  const hasMore=Boolean(data&&visibleCount<data.items.length);
  return <>
    {loading&&<p className="sr-only" role="status">Finding your kindred spirits…</p>}
    {!loading&&data?.warning&&<p className="results-note" role="status">{data.warning}</p>}
    {metadataError&&<p className="results-note" role="status">Some title details could not load. Open a title to try again.</p>}
    {!loading&&!data?.items.length?<div className="empty-state"><h2>No community connections yet.</h2><p>Try another favorite or choose All anime to include more formats.</p><button className="primary-button" onClick={onEdit}>Edit your picks <ArrowUpRight size={18}/></button></div>:
      <div className="poster-grid" aria-busy={loading}>{loading?Array.from({length:10},(_,index)=><div className="poster-skeleton" key={index}><span/><i/><i/></div>):items.map((item,index)=><button className="poster-card" key={item.title.id} data-rank={index+1} onClick={()=>onOpen(item)} aria-label={`Recommendation ${index+1}: More about ${titleName(item.title)}`}>
        <div className="poster-card-image"><Poster title={item.title} eager={index<6}/><span className="poster-rank" aria-hidden="true">#{index+1}</span><span className="poster-open" aria-hidden="true"><ArrowUpRight size={21}/></span></div>
        <h2>{titleName(item.title)}</h2><p className="card-metadata"><span>{item.title.year??'Year unavailable'}</span><span className="format-badge">{titleFormat(item.title)}</span></p>
      </button>)}</div>}
    {!loading&&Boolean(data?.items.length)&&<div className="recommendation-pagination">
      {hasMore?<button type="button" className="recommendation-load-more" onClick={onLoadMore}>Load more</button>:data?.recommendationsComplete!==false&&<p className="recommendation-end">No more recommendations for these picks.</p>}
      <span className="sr-only" role="status">{items.length} recommendations shown.</span>
    </div>}
  </>;
}

export function Results({ids,type,initialSelection,onEdit,onChange,onLoaded,onOpen,status}:Props) {
  const [data,setData]=useState<RecommendationResponse|null>(null);
  const [dataSnapshot,setDataSnapshot]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [metadataError,setMetadataError]=useState(false);
  const [retry,setRetry]=useState(0);
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState<MediaTitle[]>(initialSelection.filter(title=>ids.includes(title.id)));
  const [draftType,setDraftType]=useState<OutputType>(type);
  const idKey=[...new Set(ids)].join(',');
  const snapshot=`${idKey}|${type}|${retry}`;
  const [pagination,dispatchPagination]=useReducer(recommendationPagination,{snapshot,visibleCount:10});
  const visibleCount=pagination.snapshot===snapshot?pagination.visibleCount:10;
  const pageElement=useRef<HTMLElement>(null);
  const restoreAfterAppend=useRef<{scrollX:number;scrollY:number;rank:number}|null>(null);
  const loadMore=()=>{
    restoreAfterAppend.current={scrollX:window.scrollX,scrollY:window.scrollY,rank:visibleCount+1};
    dispatchPagination({type:'more',snapshot});
  };
  useLayoutEffect(()=>{
    const previous=restoreAfterAppend.current;
    if(previous){
      pageElement.current?.querySelector<HTMLButtonElement>(`.poster-card[data-rank="${previous.rank}"]`)?.focus({preventScroll:true});
      window.scrollTo(previous.scrollX,previous.scrollY);
      restoreAfterAppend.current=null;
    }
  },[visibleCount]);
  useEffect(()=>{
    const abort=new AbortController();
    dispatchPagination({type:'reset',snapshot});
    restoreAfterAppend.current=null;
    setLoading(true);setError('');setData(null);setDataSnapshot('');setMetadataError(false);
    const requestedIds=idKey.split(',').filter(Boolean);
    setDraft(current=>requestedIds.map(id=>current.find(title=>title.id===id)??initialSelection.find(title=>title.id===id)).filter((title):title is MediaTitle=>Boolean(title)));
    if(!requestedIds.length||requestedIds.length>MAX_SELECTED_TITLES){
      setError(`Choose between one and ${MAX_SELECTED_TITLES} anime titles to get recommendations.`);setLoading(false);return;
    }
    api<RecommendationResponse>('/recommend',{method:'POST',body:JSON.stringify({ids:idKey.split(',').filter(Boolean),type}),signal:abort.signal})
      .then(result=>{
        if(abort.signal.aborted)return;
        setData(result);setDataSnapshot(snapshot);setDraft(result.seeds);onLoaded(result.seeds);setLoading(false);
      })
      .catch(e=>{if(!abort.signal.aborted&&e.name!=='AbortError')setError(e.message);})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[idKey,type,retry]);
  useEffect(()=>{
    if(dataSnapshot!==snapshot||!data)return;
    const abort=new AbortController();
    const missing=visibleMetadataIds(data.items,visibleCount);
    const batches=Array.from({length:Math.ceil(missing.length/6)},(_,index)=>missing.slice(index*6,index*6+6));
    let next=0;
    const hydrate=async()=>{
      while(next<batches.length&&!abort.signal.aborted){
        const batch=batches[next++];
        try{
          const {titles,unavailableIds}=await loadPartialTitleDetails(batch,abort.signal);
          if(abort.signal.aborted)return;
          const byId=new Map(titles.map(title=>[title.id,title]));
          setData(current=>current?{...current,items:current.items.map(item=>({...item,title:byId.has(item.title.id)?mergeTitleDetails(byId.get(item.title.id)!,item.title):item.title}))}:current);
          if(unavailableIds.length)setMetadataError(true);
        }catch(error){if(!abort.signal.aborted&&(error as Error).name!=='AbortError')setMetadataError(true);}
      }
    };
    void Promise.all([hydrate(),hydrate()]);
    return()=>abort.abort();
    // A new snapshot or visible page owns hydration. Metadata updates must not restart it.
  },[dataSnapshot,snapshot,visibleCount]);
  const updateDraft=(titles:MediaTitle[])=>{setDraft(titles);if(!editing){onLoaded(titles);onChange(titles.map(t=>t.id),type);}};
  return <main className="results-page" id="main-content" ref={pageElement}><button className="back-link" onClick={onEdit}><ArrowLeft size={19}/> Edit your picks</button>
    <h1>A few kindred spirits.</h1><p className="results-subtitle">Community connections. Your next anime.</p>
    {editing?<div className="results-editor"><SearchComposer compact autoFocus selected={draft} onSelected={setDraft} type={draftType} onType={setDraftType} onSubmit={()=>{setEditing(false);onChange(draft.map(t=>t.id),draftType);}} unavailable={status?.configured===false}/><button className="text-button cancel-edit" onClick={()=>{setDraft(data?.seeds??[]);setEditing(false);}}>Cancel</button></div>:
      <div className="results-controls"><div className="results-picks"><SelectedTitles titles={data?.seeds??draft} onRemove={id=>updateDraft((data?.seeds??draft).filter(t=>t.id!==id))}/><AddTitleButton titles={data?.seeds??draft} onClick={()=>{setDraftType(type);setEditing(true);}} loading={loading}/></div><FormatTabs value={type} onChange={t=>onChange(ids,t)}/></div>}
    <div className="results-rule"/>
    {error?<div className="empty-state" role="alert"><h2>Let’s try that again.</h2><p>{error}</p><button className="primary-button" onClick={()=>setRetry(v=>v+1)}><RefreshCw size={17}/> Try again</button></div>:
      <RecommendationCollection data={data} loading={loading} metadataError={metadataError} visibleCount={visibleCount} onLoadMore={loadMore} onOpen={onOpen} onEdit={onEdit}/>}
  </main>;
}
