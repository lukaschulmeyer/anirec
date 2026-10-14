import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, X } from 'lucide-react';
import type { MediaTitle, RankedTitle } from '../shared/types';
import { animeLabel, cachedTitleDetails, cachedTitleSeries, loadTitleDetails, loadTitleSeries, mergeTitleDetails, titleFormat, titleMetadata } from '../lib/api';
import { Poster } from './Poster';
import { useTitleLanguage } from '../lib/title-language-context';

function duration(title:MediaTitle) {
  if(title.anime){
    const anime=title.anime;
    return [anime.episodes?`${anime.episodes} ${anime.episodes===1?'episode':'episodes'}`:null,
      anime.episodeMinutes?`${Math.round(anime.episodeMinutes)} min${anime.format==='movie'?'':' per episode'}`:null].filter(Boolean).join(' · ');
  }
  return null;
}

function installmentScope(title:MediaTitle):string|null {
  const series=title.anime?.series;
  return title.anime?.format!=='movie'&&series&&series.installments.length>1?(series.id===title.id?'First installment':'This installment'):null;
}

export function AnimeFacts({title}:{title:MediaTitle}) {
  const anime=title.anime;
  if(!anime)return null;
  const scope=installmentScope(title);
  const rows:[string,string|null][]=[
    ['English title',anime.englishTitle],['Japanese title',anime.japaneseTitle],
    ['Also known as',anime.synonyms.length?anime.synonyms.join(' · '):null],
    [scope?`${scope} status`:'Status',anime.status?animeLabel(anime.status):null],
    ['Format',anime.format&&anime.format!=='unknown'?animeLabel(anime.format):null],
    [scope?`${scope} episodes`:'Episodes',anime.episodes?anime.episodes.toLocaleString():null],
    [anime.format==='movie'?'Running time':'Episode length',anime.episodeMinutes?`${Math.round(anime.episodeMinutes)} minutes`:null],
    ['Studios',anime.studios.length?anime.studios.join(', '):null],
    ['Premiered',anime.season?animeLabel(anime.season):null],['Start date',anime.startDate],['End date',anime.endDate],
    ['Source material',anime.sourceMaterial?animeLabel(anime.sourceMaterial):null],
    ['Age rating',anime.ageRating?animeLabel(anime.ageRating):null],
  ];
  return <>
    {anime.communityScore!==null&&<div className="community-rating"><strong>{anime.communityScore.toFixed(2)}<span> / 10</span></strong><div><span>{scope&&`${scope} · `}MAL community score</span><small>{anime.scoringUsers!==null?`${anime.scoringUsers.toLocaleString()} user ratings`:'Rating count unavailable'}</small></div></div>}
    <dl className="credits anime-facts">{rows.filter(([,value])=>value!==null&&value!=='').map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {anime.status==='finished_airing'&&<p className="detail-footnote">Finished airing describes this release. Its source story may continue.</p>}
  </>;
}

export function AnimeSeriesDetails({title,loading=false,error='',onRetry}:{title:MediaTitle;loading?:boolean;error?:string;onRetry:()=>void}) {
  const {titleName}=useTitleLanguage();
  const series=title.anime?.series;
  const unique=(entries:MediaTitle[])=>entries.filter((entry,index)=>entries.findIndex(other=>other.id===entry.id)===index);
  const installments=unique(series?.installments??[]).filter(entry=>entry.anime?.format!=='movie');
  const movies=unique(series?.relatedMovies??[]).filter(entry=>entry.id!==title.id);
  const renderEntries=(heading:string,entries:MediaTitle[])=>entries.length>0&&<section className="series-section" aria-label={heading}>
    <div className="series-heading"><h3>{heading}</h3><span className="series-count">{entries.length} {entries.length===1?'entry':'entries'}{series?.complete?'':' found'}</span></div>
    <ul className="series-entry-list">{entries.map(entry=><li key={entry.id}><a className="series-entry" href={`https://myanimelist.net/anime/${entry.id.replace(/^mal:/,'')}`} target="_blank" rel="noreferrer">
      <span className="series-entry-copy"><strong>{titleName(entry)}</strong><small>{entry.year??'Year unavailable'} · {titleFormat(entry)}</small></span>
      <span className="series-entry-rating" aria-label={entry.anime?.communityScore!=null?`MAL community score ${entry.anime.communityScore.toFixed(2)} out of 10`:'MAL rating unavailable'}>{entry.anime?.communityScore!=null?<>{entry.anime.communityScore.toFixed(2)}<small> / 10</small></>:'Rating unavailable'}</span><ArrowUpRight size={14} aria-hidden="true"/>
    </a></li>)}</ul>
  </section>;
  if(!title.anime||title.anime.format==='movie')return null;
  return <div className="anime-series">
    {loading&&<p className="series-note" role="status">Loading seasons, parts and related movies…</p>}
    {error&&<p className="series-note" role="status">{error} <button className="text-button" onClick={onRetry}>Try again</button></p>}
    {renderEntries('Seasons and parts',installments)}
    {renderEntries('Related movies',movies)}
    {series&&!series.complete&&!loading&&!error&&<p className="series-note" role="status">Some linked entries could not be loaded. <button className="text-button" onClick={onRetry}>Try again</button></p>}
    {series?.complete&&!installments.length&&!movies.length&&!loading&&<p className="series-note">No other linked entries are listed on MAL.</p>}
  </div>;
}

export function TitleDetailContent({title,item,loading,detailError,onRetry,onRecommend,seriesLoading=false,seriesError='',onSeriesRetry=onRetry}:{title:MediaTitle;item:RankedTitle;loading:boolean;detailError:string;onRetry:()=>void;onRecommend:(title:MediaTitle)=>void;seriesLoading?:boolean;seriesError?:string;onSeriesRetry?:()=>void}) {
  const {titleName}=useTitleLanguage();
  const scope=installmentScope(title);
  return <div className="detail-scroll"><div className="detail-poster"><Poster title={title} eager detail/></div><div className="detail-body">
      <Dialog.Title>{titleName(title)}</Dialog.Title>
      {scope&&<p className="detail-installment-scope">{scope} · Synopsis and details for this release</p>}
      <p className="detail-meta">{titleMetadata(title)}{duration(title)&&` · ${duration(title)}`}</p>
      {title.genres.length>0&&<p className="detail-genres">{title.genres.join(' · ')}</p>}
      <Dialog.Description id="detail-synopsis" className="detail-synopsis">{title.overview||(loading?'Loading synopsis…':'A synopsis is not available for this title.')}</Dialog.Description>
      {loading&&<p className="detail-footnote" role="status">Loading title details…</p>}
      {detailError&&<p className="detail-footnote" role="status">{detailError} <button className="text-button" onClick={onRetry}>Try again</button></p>}
      <AnimeFacts title={title}/><AnimeSeriesDetails title={title} loading={seriesLoading} error={seriesError} onRetry={onSeriesRetry}/>
      <div className="detail-actions">{title.sources[0]&&<a href={title.sources[0].url} target="_blank" rel="noreferrer" className="source-link">{title.anime?'View on MyAnimeList':'View source'} <ArrowUpRight size={15}/></a>}<button className="primary-button" onClick={()=>onRecommend(title)}>Find more like this <ArrowUpRight size={18}/></button></div>
    </div></div>;
}

export function DetailDialog({item,onClose,onRecommend}:{item:RankedTitle|null;onClose:()=>void;onRecommend:(title:MediaTitle)=>void}) {
  const [details,setDetails]=useState<MediaTitle|null>(item?.title??null);
  const [detailError,setDetailError]=useState('');
  const [loading,setLoading]=useState(false);
  const [retry,setRetry]=useState(0);
  const [seriesRetry,setSeriesRetry]=useState(0);
  const seriesReload=useRef<string|null>(null);
  const [seriesStatus,setSeriesStatus]=useState({id:'',loading:false,error:''});
  const opener=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    if(!item)return;
    const available=cachedTitleDetails(item.title.id)??item.title;
    setDetails(available);setDetailError('');
    if(available.anime?.detailsLoaded){setLoading(false);return;}
    const abort=new AbortController();
    setLoading(true);
    loadTitleDetails([item.title.id],abort.signal)
      .then(titles=>{if(!abort.signal.aborted)setDetails(current=>mergeTitleDetails(titles[0],current??undefined));})
      .catch(e=>{if(!abort.signal.aborted&&e.name!=='AbortError'&&!cachedTitleDetails(item.title.id)?.anime?.detailsLoaded)setDetailError('Full details could not load. Your available title information is preserved.');})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>abort.abort();
  },[item,retry]);
  useEffect(()=>{
    if(!item?.title.anime||item.title.anime.format==='movie')return;
    const id=item.title.id;
    const refresh=seriesReload.current===id;
    seriesReload.current=null;
    const cached=cachedTitleSeries(id)??cachedTitleDetails(id)??item.title;
    if(cached.anime?.series?.complete&&!refresh){
      setDetails(current=>mergeTitleDetails(cached,current??undefined));
      setSeriesStatus({id,loading:false,error:''});
      return;
    }
    const abort=new AbortController();
    setSeriesStatus({id,loading:true,error:''});
    loadTitleSeries(id,abort.signal,refresh)
      .then(value=>{if(!abort.signal.aborted){setDetails(current=>mergeTitleDetails(value,current??undefined));if(value.anime?.detailsLoaded)setDetailError('');}})
      .catch(error=>{if(!abort.signal.aborted&&error.name!=='AbortError')setSeriesStatus({id,loading:false,error:'Seasons and related movies could not load. Available details are still shown.'});})
      .finally(()=>{if(!abort.signal.aborted)setSeriesStatus(current=>({...current,loading:false}));});
    return()=>abort.abort();
  },[item,seriesRetry]);
  const title=details?.id===item?.title.id?details:item?.title;
  return <Dialog.Root open={Boolean(item)} onOpenChange={open=>{if(!open)onClose();}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="detail-dialog" aria-describedby="detail-synopsis" onOpenAutoFocus={()=>{opener.current=document.activeElement as HTMLElement;}} onCloseAutoFocus={e=>{e.preventDefault();if(opener.current?.isConnected)opener.current.focus();}}>
    <Dialog.Close className="dialog-close" aria-label="Close title details"><X size={22}/></Dialog.Close>
    {title&&item&&<TitleDetailContent title={title} item={item} loading={loading} detailError={detailError} onRetry={()=>setRetry(value=>value+1)} onRecommend={onRecommend} seriesLoading={Boolean(title.anime)&&title.anime?.format!=='movie'&&(seriesStatus.id!==title.id||seriesStatus.loading)} seriesError={seriesStatus.id===title.id?seriesStatus.error:''} onSeriesRetry={()=>{seriesReload.current=title.id;setSeriesRetry(value=>value+1);}}/>}
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
