import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MediaTitle } from '../shared/types';
import { TitleLanguageProvider } from '../lib/title-language-context';
import type { TitleLanguage } from '../lib/title-language';
import { SelectedTitles } from './SelectedTitles';
import { TitleLanguageSwitch } from './TitleLanguageSwitch';

const first: MediaTitle = { id: 'mal:1', type: 'tv', title: 'First Original', year: 2000, posterUrl: null, overview: '', genres: [], sources: [], traits: {},
  anime: { format: 'tv', englishTitle: 'Shared English Name', japaneseTitle: null, synonyms: [], startDate: null, endDate: null,
    status: null, episodes: null, episodeMinutes: null, studios: [], communityScore: null, scoringUsers: null,
    ageRating: null, sourceMaterial: null, season: null, detailsLoaded: true } };
const second: MediaTitle = { ...first, id: 'mal:2', title: 'Second Original', year: 2024 };
const render = (initialLanguage?: TitleLanguage) => renderToStaticMarkup(createElement(TitleLanguageProvider, {
  initialLanguage,
  children: createElement('div', null, createElement(TitleLanguageSwitch), createElement(SelectedTitles, { titles: [first, second], onRemove: () => {} })),
}));

describe('title language controls and selected titles', () => {
  it('defaults to an accessible English radio choice and disambiguates translated name collisions', () => {
    const html = render();
    expect(html).toContain('<legend class="sr-only">Title language</legend>');
    expect(html).toMatch(/type="radio"[^>]*checked=""[^>]*value="english"/);
    expect(html).toContain('aria-label="Remove Shared English Name (2000)"');
    expect(html).toContain('aria-label="Remove Shared English Name (2024)"');
  });

  it('uses Romaji consistently for visible chip labels, tooltips and remove controls', () => {
    const html = render('romaji');
    expect(html).toMatch(/type="radio"[^>]*checked=""[^>]*value="romaji"/);
    expect(html).toContain('title="First Original (2000)"');
    expect(html).toContain('aria-label="Remove First Original"');
    expect(html).toContain('aria-label="Remove Second Original"');
    expect(html).not.toContain('Shared English Name');
  });
});
