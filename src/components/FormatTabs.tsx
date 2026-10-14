import { useId } from 'react';
import type { OutputType } from '../shared/types';

const options: Array<{value:OutputType;label:string}> = [{value:'both',label:'All anime'},{value:'tv',label:'Series'},{value:'movie',label:'Movies'}];
export function FormatTabs({value,onChange}:{value:OutputType;onChange:(v:OutputType)=>void}) {
  const name=useId();
  return <fieldset className="format-tabs"><legend className="sr-only">Recommendation type</legend>
    {options.map(option=><label key={option.value} className={value===option.value?'selected':''}>
      <input type="radio" name={name} value={option.value} checked={value===option.value} onChange={()=>onChange(option.value)}/><span>{option.label}</span>
    </label>)}
  </fieldset>;
}
