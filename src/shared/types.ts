export type MediaType = 'movie' | 'tv';
export type OutputType = 'both' | MediaType;

export interface Source {
  name: string;
  url: string;
  license?: string;
  retrievedAt?: string;
  note?: string;
}

/** Official MAL releases linked as one show; films retain their own identities. */
export interface AnimeSeries {
  id: string;
  /** Actual provider installments, including split parts, without invented season numbers. */
  installments: MediaTitle[];
  relatedMovies: MediaTitle[];
  complete: boolean;
}

export interface MediaTitle {
  /** Stable provider-qualified identity, for example mal:1. */
  id: string;
  type: MediaType;
  title: string;
  year: number | null;
  posterUrl: string | null;
  posterPreviewUrl?: string | null;
  overview: string;
  genres: string[];
  runtime?: number | null;
  sources: Source[];
  /** Empty compatibility field in the public response; no weighted tags are generated. */
  traits: Record<string, never>;
  anime?: {
    format: string;
    englishTitle: string | null;
    japaneseTitle: string | null;
    synonyms: string[];
    startDate: string | null;
    endDate: string | null;
    status: string | null;
    episodes: number | null;
    episodeMinutes: number | null;
    studios: string[];
    communityScore: number | null;
    scoringUsers: number | null;
    ageRating: string | null;
    sourceMaterial: string | null;
    season: string | null;
    detailsLoaded: boolean;
    series?: AnimeSeries;
  };
}

export interface RankedTitle {
  title: MediaTitle;
  /** Relative support, never a calibrated probability of enjoyment. */
  score: number;
  explanation: string;
  /** Retained empty response fields; AniRec uses community connections. */
  sharedTraits: never[];
  seedFits: never[];
  confidence: 'limited';
  communityMatch?: {
    matchedSeeds: number;
    totalSeeds: number;
    connections: { seedId: string; seedTitle: string; recommendations: number; normalizedSupport: number }[];
  };
}

export interface RankResult {
  items: RankedTitle[];
  note: string | null;
  signals: { sparse: boolean; conflicting: boolean };
  seedIds: string[];
}
