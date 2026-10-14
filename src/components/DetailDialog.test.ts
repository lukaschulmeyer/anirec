import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Dialog from '@radix-ui/react-dialog';
import { describe, expect, it } from 'vitest';
import type { MediaTitle, RankedTitle } from '../shared/types';
import { TitleLanguageProvider } from '../lib/title-language-context';
import { AnimeFacts, AnimeSeriesDetails, TitleDetailContent } from './DetailDialog';

const entry=(id:number,name:string,score:number|null,format='tv'):MediaTitle=>({id:`mal:${id}`,title:`Original ${name}`,type:format==='movie'?'movie':'tv',year:2020+id,posterUrl:null,overview:`Synopsis for ${name}.`,genres:[],sources:[],traits:{},anime:{format,englishTitle:name,japaneseTitle:null,synonyms:[],startDate:null,endDate:null,status:'finished_airing',episodes:12,episodeMinutes:24,studios:[],communityScore:score,scoringUsers:100,ageRating:null,sourceMaterial:null,season:null,detailsLoaded:true}});
const first=entry(1,'First release',8.1),part=entry(2,'Continuation part',8.9),movie=entry(3,'Related film',7.25,'movie');
const grouped:MediaTitle={...first,anime:{...first.anime!,series:{id:first.id,installments:[first,part],relatedMovies:[movie],complete:true}}};
const text=(html:string)=>html.replace(/<[^>]*>/g,'');

describe('actual MAL series entries',()=>{
  it('lists factual installment names and individual ratings, with movies in a separate section',()=>{
    const html=renderToStaticMarkup(createElement(AnimeSeriesDetails,{title:grouped,onRetry:()=>{}}));
    expect(text(html)).toContain('Seasons and parts2 entries');
    expect(text(html)).toContain('Related movies1 entry');
    for(const value of ['First release','Continuation part','Related film','8.10','8.90','7.25','2021','2022','2023'])expect(text(html)).toContain(value);
    expect(html).toContain('href="https://myanimelist.net/anime/2"');
    const sections=html.split('aria-label="Related movies"');
    expect(sections[0]).not.toContain('Related film');
    expect(sections[1]).toContain('Related film');
    expect(text(html)).not.toMatch(/Season 1|Season 2|series score|average score/i);
  });

  it('scopes the grouped synopsis, status, episodes and main rating to the first installment',()=>{
    const item:RankedTitle={title:grouped,score:.5,sharedTraits:[],seedFits:[],explanation:'',confidence:'limited'};
    const html=renderToStaticMarkup(createElement(Dialog.Root,{open:true},createElement(TitleDetailContent,{title:grouped,item,loading:false,detailError:'',onRetry:()=>{},onRecommend:()=>{}})));
    const copy=text(html);
    expect(copy).toContain('First installment · Synopsis and details for this release');
    expect(copy).toContain('First installment · MAL community score');
    expect(copy).toContain('First installment statusFinished airing');
    expect(copy).toContain('First installment episodes12');
    expect(copy.indexOf('First installment · Synopsis')).toBeLessThan(copy.indexOf('Synopsis for First release.'));
  });

  it('keeps a film’s own rating and identity, and never labels it the first installment',()=>{
    const film={...movie,anime:{...movie.anime!,series:grouped.anime!.series}};
    const html=renderToStaticMarkup(createElement(AnimeFacts,{title:film}));
    expect(text(html)).toContain('7.25');
    expect(text(html)).not.toMatch(/First installment|8\.10/);
    const related=renderToStaticMarkup(createElement(AnimeSeriesDetails,{title:film,onRetry:()=>{}}));
    expect(related).toBe('');
  });

  it('uses the title-language preference for all installment and movie links',()=>{
    const html=renderToStaticMarkup(createElement(TitleLanguageProvider,{initialLanguage:'romaji',children:createElement(AnimeSeriesDetails,{title:grouped,onRetry:()=>{}})}));
    for(const name of ['Original First release','Original Continuation part','Original Related film'])expect(text(html)).toContain(name);
  });

  it('marks partial counts and unavailable ratings honestly and offers retry without losing entries',()=>{
    const partial={...grouped,anime:{...grouped.anime!,series:{...grouped.anime!.series!,installments:[entry(5,'Available part',null)],complete:false}}};
    const html=renderToStaticMarkup(createElement(AnimeSeriesDetails,{title:partial,onRetry:()=>{}}));
    expect(text(html)).toContain('1 entry found');
    expect(text(html)).toContain('Rating unavailable');
    expect(text(html)).toContain('Some linked entries could not be loaded.');
    expect(text(html)).toContain('Try again');
    expect(text(html)).not.toContain('0.00');
    const failed=renderToStaticMarkup(createElement(AnimeSeriesDetails,{title:partial,error:'Seasons could not load.',onRetry:()=>{}}));
    expect(text(failed)).toContain('Available part');
    expect(text(failed)).toContain('Seasons could not load.');
  });
});
