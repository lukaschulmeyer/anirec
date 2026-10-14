import { useId } from 'react';
import { useTitleLanguage } from '../lib/title-language-context';
import type { TitleLanguage } from '../lib/title-language';

export function TitleLanguageSwitch() {
  const { language, setLanguage } = useTitleLanguage();
  const groupName = useId();
  return <fieldset className="title-language">
    <legend className="sr-only">Title language</legend>
    {(['english', 'romaji'] as const).map((option: TitleLanguage) => <label className="title-language-option" key={option}>
      <input type="radio" name={groupName} value={option} checked={language === option} onChange={() => setLanguage(option)}/>
      <span>{option === 'english' ? 'English' : 'Romaji'}</span>
    </label>)}
  </fieldset>;
}
