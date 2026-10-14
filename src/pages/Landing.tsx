import type { CatalogStatus } from '../lib/api';
import type { MediaTitle, OutputType } from '../shared/types';
import { SearchComposer } from '../components/SearchComposer';
import { Poster } from '../components/Poster';

export function Landing({selected,onSelected,type,onType,onSubmit,featured,status,restoring=false,selectionBlocked=false}:{selected:MediaTitle[];onSelected:(t:MediaTitle[])=>void;type:OutputType;onType:(t:OutputType)=>void;onSubmit:()=>void;featured:MediaTitle[];status:CatalogStatus|null;restoring?:boolean;selectionBlocked?:boolean}) {
  return <main className="landing-page" id="main-content"><div className="landing-center">
    <div className="hero-wordmark" aria-label="AniRec">AniRec<span aria-hidden="true">*</span></div>
    <h1>Your next obsession.</h1><p className="landing-subtitle">Start with an anime you love. Follow the connections fans made.</p>
    <SearchComposer selected={selected} onSelected={onSelected} type={type} onType={onType} onSubmit={onSubmit} unavailable={status?.configured===false||restoring||selectionBlocked}/>
    {restoring&&<p className="search-helper" role="status">Restoring your picks…</p>}
    {status?.configured===false&&<p className="setup-note" role="status">Anime search is temporarily unavailable. Please try again later.</p>}
  </div><div className="poster-fan" aria-hidden="true"><div className="fan-hand">{featured.slice(0,5).map((title,index)=><div className={`fan-item fan-item-${index}`} key={title.id}><Poster title={title} eager/></div>)}</div></div></main>;
}
