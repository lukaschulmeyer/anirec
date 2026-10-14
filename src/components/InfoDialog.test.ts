import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { InfoDialogBody } from './InfoDialog';
import { AnimeFacts, TitleDetailContent } from './DetailDialog';
import * as Dialog from '@radix-ui/react-dialog';
import { TitleLanguageProvider } from '../lib/title-language-context';
import type { CatalogStatus } from '../lib/api';
import type { MediaTitle, RankedTitle } from '../shared/types';

const body=(kind:'how'|'data',status:CatalogStatus|null)=>renderToStaticMarkup(createElement(InfoDialogBody,{kind,status}));
const text=(html:string)=>html.replace(/<[^>]*>/g,'');

describe('anime metadata and recommendation explanation',()=>{
  const status:CatalogStatus={mode:'live',label:'Anime discovery',provider:'MyAnimeList',configured:true};
  const title:MediaTitle={id:'mal:123',type:'tv',title:'Test title',year:2024,posterUrl:null,overview:'Synopsis',genres:['Action'],sources:[],traits:{},
    anime:{format:'tv',englishTitle:'English name',japaneseTitle:'日本語',synonyms:['Another name'],startDate:'2024-01-01',endDate:'2024-03-30',status:'finished_airing',
      episodes:12,episodeMinutes:24,studios:['Test studio'],communityScore:8.12,scoringUsers:1234,ageRating:'pg_13',sourceMaterial:'light_novel',season:'Winter 2024',detailsLoaded:true}};

  it('shows MAL provenance, score boundaries and configuration state without legacy data claims',()=>{
    const html=body('data',{...status,configured:false});
    expect(text(html)).toContain('official MyAnimeList API');
    expect(text(html)).toContain('temporarily unavailable');
    expect(text(html)).not.toMatch(/Client ID|API key|\.env|\biRec\b/);
    expect(text(html)).toContain('does not determine your match order');
    expect(text(html)).not.toMatch(/TMDB|TVmaze|MovieLens|stored tags|IMDb/);
    expect(html).toContain('https://myanimelist.net/apiconfig/references/api/v2');
    const how=text(body('how',status));
    expect(how).toContain('Each of your picks gets equal influence');
    expect(how).not.toMatch(/prepared in advance|fixed comparison of tags/);
  });

  it('displays factual anime metadata and labels the community score independently',()=>{
    const copy=text(renderToStaticMarkup(createElement(AnimeFacts,{title})));
    for(const value of ['English name','日本語','Another name','Finished airing','12','24 minutes','Test studio','Winter 2024','2024-01-01','2024-03-30','Light novel','PG-13','8.12','1,234 user ratings','MAL community score'])expect(copy).toContain(value);
    expect(copy).toContain('Its source story may continue');
    expect(copy).not.toMatch(/match score|Director|Cast/);
  });

  it('omits unavailable facts rather than presenting missing scores or duration as zero',()=>{
    const unknown:MediaTitle={...title,anime:{...title.anime!,episodes:null,episodeMinutes:null,studios:[],communityScore:null,scoringUsers:null}};
    const copy=text(renderToStaticMarkup(createElement(AnimeFacts,{title:unknown})));
    expect(copy).not.toMatch(/0\.00|user ratings|Episode length|Studios/);
  });

  it('omits the removed connection section while retaining synopsis, community rating and factual metadata',()=>{
    const item:RankedTitle={title,score:.4,explanation:'Recommended alongside both picks.',sharedTraits:[],seedFits:[],confidence:'limited',
      communityMatch:{matchedSeeds:2,totalSeeds:2,connections:[{seedId:'mal:1',seedTitle:'First pick',recommendations:400,normalizedSupport:.4},{seedId:'mal:2',seedTitle:'Second pick',recommendations:4,normalizedSupport:.4}]}};
    const content=createElement(TitleDetailContent,{title,item,loading:false,detailError:'',onRetry:()=>{},onRecommend:()=>{}});
    const html=renderToStaticMarkup(createElement(Dialog.Root,{open:true},content));
    const copy=text(html);
    expect(html).toMatch(/<h2[^>]*>English name<\/h2>/);
    for(const value of ['Synopsis','MAL community score','8.12','English name','日本語','Test studio','Find more like this'])expect(copy).toContain(value);
    expect(copy).not.toMatch(/The connection|Recommended alongside both picks|First pick|Second pick|400 community|scaled|40%/);
    const romaji=renderToStaticMarkup(createElement(TitleLanguageProvider,{initialLanguage:'romaji',children:createElement(Dialog.Root,{open:true},content)}));
    expect(romaji).toMatch(/<h2[^>]*>Test title<\/h2>/);
    expect(text(romaji)).toContain('English titleEnglish name');
  });
});
