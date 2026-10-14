import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RecommendationResponse } from '../lib/api';
import { AddTitleButton, RecommendationCollection, recommendationPagination, visibleMetadataIds } from './Results';

const response=(count:number):RecommendationResponse=>({
  seeds:[],seedIds:[],mode:'live',catalogNote:'Generic catalog explanation',note:'Generic match explanation',candidateCount:count,signals:{sparse:false,conflicting:false},
  items:Array.from({length:count},(_,index)=>({title:{id:`mal:${index+1}`,title:`Title ${index+1}`,type:'tv',year:2024,posterUrl:null,overview:'',genres:[],sources:[],traits:{}},score:1-index/100,sharedTraits:[],seedFits:[],confidence:'limited',explanation:'Connection prose',communityMatch:{matchedSeeds:1,totalSeeds:1,connections:[]}})),
});

describe('visible metadata and resolved selections',()=>{
  const compactFilms=(count:number)=>response(count).items.map(item=>({...item,title:{...item.title,type:'movie' as const,anime:{format:'movie',englishTitle:null,japaneseTitle:null,synonyms:[],startDate:null,endDate:null,status:null,episodes:null,episodeMinutes:null,studios:[],communityScore:null,scoringUsers:null,ageRating:null,sourceMaterial:null,season:null,detailsLoaded:false}}}));

  it('limits a 400-item compact pool to the first ten visible IDs',()=>{
    expect(visibleMetadataIds(compactFilms(400),10)).toEqual(Array.from({length:10},(_,index)=>`mal:${index+1}`));
  });

  it('hydrates only the newly visible ten and then the short final page as earlier pages finish',()=>{
    const items=compactFilms(23);
    for(let index=0;index<10;index++)items[index].title.anime.detailsLoaded=true;
    expect(visibleMetadataIds(items,10)).toEqual([]);
    expect(visibleMetadataIds(items,20)).toEqual(Array.from({length:10},(_,index)=>`mal:${index+11}`));
    for(let index=10;index<20;index++)items[index].title.anime.detailsLoaded=true;
    expect(visibleMetadataIds(items,30)).toEqual(['mal:21','mal:22','mal:23']);
  });

  it('does not replace a complete visible card with an unseen metadata request and deduplicates visible IDs',()=>{
    const items=compactFilms(30);
    for(let index=0;index<10;index++)items[index].title.anime.detailsLoaded=true;
    expect(visibleMetadataIds(items,10)).toEqual([]);
    const duplicate=compactFilms(1)[0];
    expect(visibleMetadataIds([duplicate,duplicate],10)).toEqual(['mal:1']);
  });

  it('enables adding after release aliases resolve to one selected show, and enforces eight unique shows',()=>{
    const titles=response(8).items.map(item=>item.title);
    const renderButton=(selected:typeof titles,loading=false)=>renderToStaticMarkup(createElement(AddTitleButton,{titles:selected,loading,onClick:()=>{}}));
    expect(renderButton([titles[0]])).not.toContain('disabled=""');
    expect(renderButton(Array.from({length:8},()=>titles[0]))).not.toContain('disabled=""');
    expect(renderButton(titles)).toContain('disabled=""');
    expect(renderButton([titles[0]],true)).toContain('disabled=""');
  });
});
const render=(data:RecommendationResponse,visibleCount=10,metadataError=false)=>renderToStaticMarkup(createElement(RecommendationCollection,{data,visibleCount,metadataError,loading:false,onLoadMore:()=>{},onOpen:()=>{},onEdit:()=>{}}));
const ranks=(html:string)=>[...html.matchAll(/data-rank="(\d+)"/g)].map(match=>Number(match[1]));

describe('recommendation pages',()=>{
  it('shows exactly ten ranked cards initially and ends honestly for a ten-result pool',()=>{
    const html=render(response(10));
    expect(ranks(html)).toEqual(Array.from({length:10},(_,index)=>index+1));
    expect(html).toContain('No more recommendations for these picks.');
    expect(html).not.toContain('>Load more<');
  });

  it('reveals 23 results as ten, twenty, then a short final page without changing rank order',()=>{
    const data=response(23);
    let pagination={snapshot:'mal:1|both|0',visibleCount:10};
    for(const expected of [10,20,23]){
      const html=render(data,pagination.visibleCount);
      expect(ranks(html)).toEqual(Array.from({length:expected},(_,index)=>index+1));
      expect(html.includes('>Load more<')).toBe(expected<23);
      expect(html.includes('No more recommendations for these picks.')).toBe(expected===23);
      pagination=recommendationPagination(pagination,{type:'more',snapshot:pagination.snapshot});
    }
    expect(data.items[22].title.id).toBe('mal:23');
  });

  it.each(['mal:2|both|0','mal:1|movie|0','mal:1|both|1'])('resets an expanded page for a changed picks/filter/retry snapshot %s',snapshot=>{
    const reset=recommendationPagination({snapshot:'mal:1|both|0',visibleCount:30},{type:'reset',snapshot});
    expect(reset.visibleCount).toBe(10);
    expect(ranks(render(response(23),reset.visibleCount))).toHaveLength(10);
  });

  it('offers editing without a load-more button or fake cards for an empty response',()=>{
    const html=render(response(0));
    expect(ranks(html)).toEqual([]);
    expect(html).toContain('No community connections yet.');
    expect(html).toContain('Edit your picks');
    expect(html).not.toContain('>Load more<');
  });

  it('retains an incomplete-data warning without falsely claiming the pool is exhausted',()=>{
    const html=render({...response(7),recommendationsComplete:false,warning:'Some recommendations could not be loaded.'},10,true);
    expect(html).toContain('Some recommendations could not be loaded.');
    expect(html).toContain('Some title details could not load.');
    expect(html).not.toContain('No more recommendations for these picks.');
  });

  it('omits generic count, ordering, source notes and per-card connection copy',()=>{
    const html=render(response(23));
    expect(html).not.toMatch(/results-label|results-order-note|card-connection|Generic catalog explanation|Generic match explanation|Recommended by fans|Connected to|23 titles|Highest ranked first/);
    expect(html).toContain('aria-label="Recommendation 1: More about Title 1"');
  });
});
