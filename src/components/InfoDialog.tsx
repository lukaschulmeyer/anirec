import * as Dialog from '@radix-ui/react-dialog';
import { useRef } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import type { CatalogStatus } from '../lib/api';
export function InfoDialogBody({kind,status}:{kind:'how'|'data'|null;status:CatalogStatus|null}) {
  if(!status&&kind!=='how')return <div className="data-content"><p>Catalog details are loading.</p></div>;
  return kind==='how'?<div className="how-steps">
    <section><span>01</span><div><h3>Pick your favorites.</h3><p>Search for one anime or add a few. Choose all anime, series, or movies for your recommendations.</p></div></section>
    <section><span>02</span><div><h3>Follow the shared connections.</h3><p>MyAnimeList users connect anime they recommend together. Each of your picks gets equal influence, with stronger shared support moving a recommendation up the list.</p></div></section>
    <section><span>03</span><div><h3>Meet your next obsession.</h3><p>Explore the posters and load ten more when available. Open a show for its story, seasons, individual ratings, and related movies.</p></div></section>
  </div>:<div className="data-content"><h3>Connections made by anime fans.</h3>
    <p>Titles, artwork, synopses, and community recommendations come from the official MyAnimeList API. Details load as you explore.</p>
    <p>Each selected show gets equal influence. We scale the recommendations for each installment relative to its strongest connection, keep the strongest observed connection between two shows, and favor support shared across your picks. Choosing two seasons of the same show counts as one pick.</p>
    <p>Seasons and split parts are grouped using MAL’s story relationships. Movies keep their own cards and appear separately inside the show’s details. Each rating belongs to its original MAL entry; there is no combined show rating.</p>
    <p>Results reflect the connections available through MAL’s API. Other community connections may exist. The Series filter includes TV series, OVAs, ONAs, and specials; All anime also includes music and titles with an unknown format.</p>
    <p>The community score describes how MAL users rated an anime. It does not determine your match order. Recommendation counts are evidence of a connection, not a prediction that you will enjoy a title.</p>
    <p>Some titles have missing artwork or details. Finished airing does not necessarily mean the entire source story has been adapted.</p>
    {status?.configured===false&&<p>Anime search is temporarily unavailable. Please try again later.</p>}
    <div className="source-links"><a href="https://myanimelist.net" target="_blank" rel="noreferrer">MyAnimeList <ArrowUpRight size={15}/></a><a href="https://myanimelist.net/apiconfig/references/api/v2" target="_blank" rel="noreferrer">API documentation <ArrowUpRight size={15}/></a></div>
    <small>Independent, noncommercial project. AniRec is not affiliated with or endorsed by MyAnimeList. Anime artwork belongs to its respective rights holders.</small>
  </div>;

}

export function InfoDialog({kind,onClose,status}:{kind:'how'|'data'|null;onClose:()=>void;status:CatalogStatus|null}) {
  const opener=useRef<HTMLElement|null>(null);
  return <Dialog.Root open={Boolean(kind)} onOpenChange={open=>{if(!open)onClose();}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="info-dialog" onOpenAutoFocus={()=>{opener.current=document.activeElement as HTMLElement;}} onCloseAutoFocus={e=>{e.preventDefault();if(opener.current?.isConnected)opener.current.focus();}}>
    <Dialog.Close className="dialog-close" aria-label="Close information"><X size={22}/></Dialog.Close>
    <Dialog.Title>{kind==='how'?'Follow your taste.':'Behind the posters.'}</Dialog.Title>
    <Dialog.Description className="dialog-intro">{kind==='how'?'A favorite is a very good place to start.':'Anime fans, clear sources, and connections you can follow.'}</Dialog.Description>
    <InfoDialogBody kind={kind} status={status}/>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
