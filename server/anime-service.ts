import type { MediaTitle, OutputType, RankResult } from '../src/shared/types';

/** Service contract shared by the official MAL adapter and the HTTP boundary. */
export interface CatalogService {
  mode: 'live';
  provider: 'mal';
  configured?: () => boolean;
  connection?: () => 'configured' | 'verified' | 'unavailable';
  close?: () => void | Promise<void>;
  search(query: string): Promise<MediaTitle[]>;
  searchPage?(query: string, offset: number): Promise<{ titles: MediaTitle[]; nextOffset: number | null }>;
  titles(ids: string[]): Promise<MediaTitle[]>;
  series?(id: string): Promise<MediaTitle>;
  hydrate?(ids: string[]): Promise<{ titles: MediaTitle[]; unavailableIds: string[] }>;
  recommend?(ids: string[], type: OutputType): Promise<PreparedRecommendations>;
  candidates(seeds: MediaTitle[], type: OutputType): Promise<{ titles: MediaTitle[]; seeds?: MediaTitle[]; note?: string }>;
  featured(): Promise<MediaTitle[]>;
}

export interface PreparedRecommendations extends RankResult {
  seeds: MediaTitle[];
  candidateCount: number;
  matchedCandidateCount: number;
  catalogNote: string | null;
  recommendationsComplete?: boolean;
  warning?: string | null;
}
