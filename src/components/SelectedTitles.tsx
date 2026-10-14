import { X } from 'lucide-react';
import type { MediaTitle } from '../shared/types';
import { Poster } from './Poster';
import { useTitleLanguage } from '../lib/title-language-context';

export function SelectedTitles({titles,onRemove}:{titles:MediaTitle[];onRemove:(id:string)=>void}) {
  const {titleName}=useTitleLanguage();
  const names=new Map(titles.map(title=>[title.id,titleName(title)]));
  return <div className="selected-titles" aria-label="Your selected titles">
    {titles.map(title=>{
      const name=names.get(title.id)!;
      const duplicate=titles.some(other=>other.id!==title.id&&names.get(other.id)===name);
      const label=`${name}${duplicate?` (${title.year??'?'})`:''}`;
      return <div className="selected-chip" key={title.id}>
        <Poster title={title} eager thumbnail/><span title={`${name} (${title.year??'year unavailable'})`}>{label}</span><button type="button" aria-label={`Remove ${label}`} onClick={()=>onRemove(title.id)}><X size={15}/></button>
      </div>;
    })}
  </div>;
}
