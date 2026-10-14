import type { MediaTitle } from '../shared/types';

export type TitleLanguage = 'english' | 'romaji';
export const TITLE_LANGUAGE_STORAGE_KEY = 'anirec.titleLanguage.v1';
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function displayTitle(title: MediaTitle, language: TitleLanguage): string {
  const original = title.title.trim();
  const english = title.anime?.englishTitle?.trim();
  return (language === 'english' ? english || original : original || english) || 'Title unavailable';
}

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readTitleLanguage(storage: PreferenceStorage | null = browserStorage()): TitleLanguage {
  try {
    return storage?.getItem(TITLE_LANGUAGE_STORAGE_KEY) === 'romaji' ? 'romaji' : 'english';
  } catch {
    return 'english';
  }
}

export function saveTitleLanguage(language: TitleLanguage, storage: PreferenceStorage | null = browserStorage()): void {
  try {
    storage?.setItem(TITLE_LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The preference still applies to this visit if browser storage is unavailable.
  }
}
