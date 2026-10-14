import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaTitle } from '../shared/types';
import { displayTitle, readTitleLanguage, saveTitleLanguage, TITLE_LANGUAGE_STORAGE_KEY } from './title-language';

const title: MediaTitle = {
  id: 'mal:123', type: 'tv', title: 'Hagane no Monogatari', year: 2024, posterUrl: null,
  overview: '', genres: [], traits: {}, sources: [],
  anime: { format: 'tv', englishTitle: 'The Steel Story', japaneseTitle: '鋼の物語', synonyms: [],
    startDate: null, endDate: null, status: null, episodes: null, episodeMinutes: null, studios: [],
    communityScore: null, scoringUsers: null, ageRating: null, sourceMaterial: null, season: null, detailsLoaded: true },
};

afterEach(() => vi.unstubAllGlobals());

describe('title language preference', () => {
  it('uses factual English or original MAL names without modifying the title identity', () => {
    const before = JSON.stringify(title);
    expect(displayTitle(title, 'english')).toBe('The Steel Story');
    expect(displayTitle(title, 'romaji')).toBe('Hagane no Monogatari');
    expect(JSON.stringify(title)).toBe(before);
  });

  it.each([null, '', '   '])('falls back to the original name when English is unavailable (%s)', englishTitle => {
    expect(displayTitle({ ...title, anime: { ...title.anime!, englishTitle } }, 'english')).toBe(title.title);
  });

  it('supports compact records without anime metadata and does not substitute Japanese or synonyms', () => {
    expect(displayTitle({ ...title, anime: undefined }, 'english')).toBe(title.title);
    expect(displayTitle({ ...title, anime: { ...title.anime!, englishTitle: null, synonyms: ['An alternate title'] } }, 'english')).toBe(title.title);
  });

  it('restores a saved preference and defaults invalid or missing values to English', () => {
    const entries = new Map<string, string>();
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } };
    expect(readTitleLanguage(storage)).toBe('english');
    saveTitleLanguage('romaji', storage);
    expect(entries.get(TITLE_LANGUAGE_STORAGE_KEY)).toBe('romaji');
    expect(readTitleLanguage(storage)).toBe('romaji');
    saveTitleLanguage('english', storage);
    expect(readTitleLanguage(storage)).toBe('english');
    entries.set(TITLE_LANGUAGE_STORAGE_KEY, 'unrecognized');
    expect(readTitleLanguage(storage)).toBe('english');
  });

  it('keeps browser storage failures nonfatal', () => {
    const unavailable = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Full'); } };
    expect(readTitleLanguage(unavailable)).toBe('english');
    expect(() => saveTitleLanguage('romaji', unavailable)).not.toThrow();
    expect(readTitleLanguage(null)).toBe('english');
    expect(() => saveTitleLanguage('romaji', null)).not.toThrow();
  });

  it('supports rendering without a window and browsers that block access to localStorage itself', () => {
    vi.stubGlobal('window', undefined);
    expect(readTitleLanguage()).toBe('english');
    expect(() => saveTitleLanguage('romaji')).not.toThrow();
    vi.stubGlobal('window', Object.defineProperty({}, 'localStorage', { get: () => { throw new Error('Security restriction'); } }));
    expect(readTitleLanguage()).toBe('english');
    expect(() => saveTitleLanguage('romaji')).not.toThrow();
  });
});
