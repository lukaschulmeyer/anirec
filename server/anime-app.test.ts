import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createAnimeApp as createApp } from './anime-http';
import { createMalService } from './mal-service';

// Synthetic upstream responses exercise the real service and HTTP routes.
// They are never installed as a live catalog or presented as MAL observations.
function fixture() {
  const rows: Record<number, Record<string, unknown>> = {};
  const row = (id: number, title: string, media_type = 'tv') => ({
    id, title, media_type, main_picture: {medium:'https://cdn.myanimelist.net/images/anime/test.jpg'},
    synopsis: `A test synopsis for ${title}.`, genres:[{id:1,name:'Action'}],
    start_date:'2020-01-01', end_date:'2020-06-01', status:'finished_airing', num_episodes:12,
    average_episode_duration:1440, studios:[{id:1,name:'Fixture Studio'}],
    mean:8.2, num_scoring_users:100, alternative_titles:{en:`${title} English`,ja:'テスト',synonyms:[]},
    rating:'pg_13',source:'manga',start_season:{year:2020,season:'winter'}, recommendations:[], related_anime:[],
  });
  rows[1]=row(1,'First favorite'); rows[2]=row(2,'Second favorite');
  rows[3]=row(3,'Balanced discovery'); rows[4]=row(4,'One-sided discovery','movie');
  rows[5]=row(5,'Small connection');
  rows[1].recommendations=[{node:rows[3],num_recommendations:400},{node:rows[4],num_recommendations:900},
    {node:rows[5],num_recommendations:1},{node:{id:1,title:'First favorite'},num_recommendations:1000}];
  rows[2].recommendations=[{node:rows[3],num_recommendations:4},{node:rows[5],num_recommendations:1},
    {node:{id:2,title:'Second favorite'},num_recommendations:10}];
  const calls: string[]=[];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url=new URL(String(input)); calls.push(url.pathname);
    expect(new Headers(init?.headers).get('X-MAL-CLIENT-ID')).toBe('fixture-client');
    if(url.pathname==='/v2/anime') return Response.json({data:[{node:rows[1]},{node:rows[2]}]});
    if(url.pathname==='/v2/anime/ranking') return Response.json({data:[{node:rows[1]},{node:rows[2]}]});
    const id=Number(url.pathname.split('/').at(-1));
    // Avoid recursive recommendation objects when serializing test seeds.
    const detail=rows[id];
    return detail ? Response.json(detail) : Response.json({error:'not_found'},{status:404});
  }) as typeof fetch;
  return {app:createApp(createMalService('fixture-client',fetcher)),calls};
}

describe('anime HTTP integration',()=>{
  it('exposes setup status without a credential or sample fallback',async()=>{
    const app=createApp(createMalService(undefined));
    const status=await request(app).get('/api/status').expect(200);
    expect(status.body).toMatchObject({provider:'MyAnimeList',configured:false});
    expect((await request(app).get('/api/featured').expect(200)).body.titles).toEqual([]);
    const result=await request(app).get('/api/search').query({q:'test'}).expect(503);
    expect(result.body.error).toEqual(expect.any(String));
  });

  it('connects search, equal-input scoring, title hydration and format filtering',async()=>{
    const {app}=fixture();
    const found=await request(app).get('/api/search').query({q:'favorite'}).expect(200);
    expect(found.body.titles.map((t:{id:string})=>t.id)).toEqual(['mal:1','mal:2']);
    const result=await request(app).post('/api/recommend').send({ids:['mal:1','mal:2'],type:'both'}).expect(200);
    expect(result.body.items[0].title.id).toBe('mal:3');
    expect(result.body.items[0].score).toBeCloseTo(0.4);
    expect(result.body.items[0].communityMatch).toMatchObject({matchedSeeds:2,totalSeeds:2});
    expect(result.body.items.map((item:{title:{id:string}})=>item.title.id)).not.toContain('mal:1');
    const reversed=await request(app).post('/api/recommend').send({ids:['mal:2','mal:1','mal:1']}).expect(200);
    expect(reversed.body.items).toEqual(result.body.items);
    const details=await request(app).get('/api/titles').query({ids:'mal:3'}).expect(200);
    expect(details.body.titles[0]).toMatchObject({id:'mal:3',overview:'A test synopsis for Balanced discovery.',
      anime:{episodes:12,episodeMinutes:24,studios:['Fixture Studio'],communityScore:8.2,detailsLoaded:true}});
    const movies=await request(app).post('/api/recommend').send({ids:['mal:1','mal:2'],type:'movie'}).expect(200);
    expect(movies.body.items.map((item:{title:{id:string}})=>item.title.id)).toEqual(['mal:4']);
    expect(JSON.stringify(result.body)).not.toContain('fixture-client');
    expect(result.headers['cache-control']).toBe('no-store');
  });

  it('rejects malformed IDs before upstream access',async()=>{
    const {app,calls}=fixture();
    for(const id of ['mal:0','mal:-1','mal:1/../../users','https://other.invalid']) {
      await request(app).post('/api/recommend').send({ids:[id]}).expect(400);
    }
    expect(calls).toEqual([]);
  });
});
