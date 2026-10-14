import { useEffect, useState } from 'react';
import { Film } from 'lucide-react';
import type { MediaTitle } from '../shared/types';
import { useTitleLanguage } from '../lib/title-language-context';

export function Poster({title,className='',eager=false,thumbnail=false}:{title:MediaTitle;className?:string;eager?:boolean;detail?:boolean;thumbnail?:boolean}) {
  const {titleName}=useTitleLanguage();
  // Medium artwork is sufficient for tiny chips. Cards and the fan need the
  // largest source-provided image, especially on high-density screens.
  const urls=[...new Set((thumbnail?[title.posterPreviewUrl,title.posterUrl]:[title.posterUrl,title.posterPreviewUrl]).filter((url):url is string=>Boolean(url)))];
  const [attempt,setAttempt]=useState(0);
  const urlKey=urls.join('|');
  useEffect(()=>{setAttempt(0);},[urlKey]);
  const url=urls[attempt];
  return <span className={`poster-art ${className}`}>
    {url ? <img key={url} src={url} alt="" loading={eager?'eager':'lazy'} decoding="async" onError={()=>setAttempt(value=>value+1)} /> :
      <span className="poster-fallback"><Film aria-hidden="true"/><strong>{titleName(title)}</strong><small>Artwork unavailable</small></span>}
  </span>;
}
