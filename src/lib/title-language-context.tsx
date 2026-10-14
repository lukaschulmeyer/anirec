import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { MediaTitle } from '../shared/types';
import { displayTitle, readTitleLanguage, saveTitleLanguage, type TitleLanguage } from './title-language';

interface TitleLanguagePreference {
  language: TitleLanguage;
  setLanguage: (language: TitleLanguage) => void;
  titleName: (title: MediaTitle) => string;
}

const TitleLanguageContext = createContext<TitleLanguagePreference>({
  language: 'english',
  setLanguage: () => {},
  titleName: title => displayTitle(title, 'english'),
});

export function TitleLanguageProvider({ children, initialLanguage }: { children: ReactNode; initialLanguage?: TitleLanguage }) {
  const [language, setPreference] = useState<TitleLanguage>(() => initialLanguage ?? readTitleLanguage());
  const setLanguage = useCallback((next: TitleLanguage) => {
    setPreference(next);
    saveTitleLanguage(next);
  }, []);
  const value = useMemo(() => ({ language, setLanguage, titleName: (title: MediaTitle) => displayTitle(title, language) }), [language, setLanguage]);
  return <TitleLanguageContext.Provider value={value}>{children}</TitleLanguageContext.Provider>;
}

export function useTitleLanguage(): TitleLanguagePreference {
  return useContext(TitleLanguageContext);
}
