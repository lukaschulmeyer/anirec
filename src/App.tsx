import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { MediaTitle, OutputType, RankedTitle } from './shared/types';
import { api, loadTitleDetails, MAX_SELECTED_TITLES, picksUrl, recsUrl, type CatalogStatus } from './lib/api';
import { Landing } from './pages/Landing';
import { Results } from './pages/Results';
import { DetailDialog } from './components/DetailDialog';
import { InfoDialog } from './components/InfoDialog';
import { TitleLanguageProvider } from './lib/title-language-context';
import { TitleLanguageSwitch } from './components/TitleLanguageSwitch';

export default function App() {
  return <TitleLanguageProvider><AppContent/></TitleLanguageProvider>;
}

function AppContent() {
  const location=useLocation();
  const navigate=useNavigate();
  const params=new URLSearchParams(location.search);
  const results=location.pathname==='/recs';
  const ids=[...new Set((params.get('picks')??'').split(',').filter(Boolean))];
  const idKey=ids.join(',');
  const queryType=params.get('type');
  const [selected,setSelected]=useState<MediaTitle[]>([]);
  const output:OutputType=['movie','tv','both'].includes(queryType??'')?queryType as OutputType:'both';
  const selectedKey=selected.map(title=>title.id).join(',');
  const [status,setStatus]=useState<CatalogStatus|null>(null);
  const [featured,setFeatured]=useState<MediaTitle[]>([]);
  const featuredLoaded=useRef(false);
  const [info,setInfo]=useState<'how'|'data'|null>(null);
  const [detail,setDetail]=useState<RankedTitle|null>(null);
  const [initialError,setInitialError]=useState('');
  const [selectionError,setSelectionError]=useState('');
  const [restoring,setRestoring]=useState(false);
  const [retry,setRetry]=useState(0);

  useEffect(()=>{
    const abort=new AbortController();
    api<CatalogStatus>('/status',{signal:abort.signal})
      .then(value=>{if(!abort.signal.aborted)setStatus(value);})
      .catch(()=>{if(!abort.signal.aborted)setInitialError('Anime search is temporarily unavailable. Please refresh to try again.');});
    return()=>abort.abort();
  },[]);

  useEffect(()=>{
    if(results){setRestoring(false);setSelectionError('');return;}
    if(!idKey){setSelected([]);setRestoring(false);setSelectionError('');return;}
    if(idKey===selectedKey){setRestoring(false);return;}
    const requested=idKey.split(',');
    if(requested.length>MAX_SELECTED_TITLES){
      setSelectionError(`This link has more than ${MAX_SELECTED_TITLES} picks. Start a new search to choose up to eight titles.`);
      setRestoring(false);
      return;
    }
    const abort=new AbortController();
    setRestoring(true);setSelectionError('');
    loadTitleDetails(requested,abort.signal)
      .then(titles=>{if(!abort.signal.aborted)setSelected(titles);})
      .catch(e=>{if(!abort.signal.aborted&&e.name!=='AbortError')setSelectionError(`Your picks could not be restored. ${e.message}`);})
      .finally(()=>{if(!abort.signal.aborted)setRestoring(false);});
    return()=>abort.abort();
  },[results,idKey,selectedKey,retry]);

  useEffect(()=>{
    if(results||featuredLoaded.current||!status||status.configured===false)return;
    const abort=new AbortController();
    api<{titles:MediaTitle[]}>('/featured',{signal:abort.signal})
      .then(({titles})=>{if(!abort.signal.aborted){featuredLoaded.current=true;setFeatured(titles);}})
      .catch(()=>{});
    return()=>abort.abort();
  },[results,status]);

  useEffect(()=>{document.title=results?'Your anime recommendations · AniRec':'AniRec · Your next anime obsession';window.scrollTo(0,0);setDetail(null);},[location.pathname]);
  const showRecs=(nextIds:string[],nextType:OutputType)=>{
    if(!nextIds.length){setSelected([]);navigate(picksUrl([],nextType));return;}
    navigate(recsUrl(nextIds,nextType));
  };
  const edit=()=>navigate(picksUrl(ids,output));
  const updatePicks=(titles:MediaTitle[])=>{setSelected(titles);setSelectionError('');navigate(picksUrl(titles.map(title=>title.id),output),{replace:true});};
  const updateType=(nextType:OutputType)=>navigate(picksUrl(selected.map(title=>title.id),nextType),{replace:true});
  const homeUrl=picksUrl(results?ids:selected.map(title=>title.id),output);

  return <div className="app-shell"><a className="skip-link" href="#main-content">Skip to content</a>
    <header className="site-header"><Link to={homeUrl} className="brand" aria-label="AniRec home">AniRec<span aria-hidden="true">*</span></Link><div className="header-actions"><TitleLanguageSwitch/><button className="header-link" onClick={()=>setInfo('how')}>How it works</button></div></header>
    {initialError&&<p className="connection-error" role="alert">{initialError}</p>}
    {selectionError&&!results&&<div className="connection-error" role="alert"><p>{selectionError}</p><button className="text-button" onClick={()=>setRetry(value=>value+1)}>Try again</button><button className="text-button" onClick={()=>updatePicks([])}>Start a new search</button></div>}
    {results?<Results ids={ids} type={output} initialSelection={selected} onEdit={edit} onChange={showRecs} onLoaded={setSelected} onOpen={setDetail} status={status}/>:
      <Landing selected={selected} onSelected={updatePicks} type={output} onType={updateType} onSubmit={()=>showRecs(selected.map(t=>t.id),output)} featured={featured} status={status} restoring={restoring} selectionBlocked={Boolean(selectionError)}/>}
    <footer className="site-footer"><span>Good taste. Great company.</span><div><span>{status?.provider==='MyAnimeList'?'Powered by MyAnimeList':'Connecting…'}</span><span aria-hidden="true">·</span><button onClick={()=>setInfo('data')}>About the data</button><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div></footer>
    <DetailDialog item={detail} onClose={()=>setDetail(null)} onRecommend={title=>{setDetail(null);setSelected([title]);showRecs([title.id],output);}}/>
    <InfoDialog kind={info} onClose={()=>setInfo(null)} status={status}/>
  </div>;
}
