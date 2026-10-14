# Architecture and scoring

## Request flow

```text
React browser interface
  -> same-origin /api routes (Express)
  -> MAL adapter, bounded queue and caches
  -> official MyAnimeList API
```

`api/index.ts` is the Vercel entry point. `server/index.ts` runs the same API locally alongside Vite or the built frontend. The Client ID stays on the server and is sent to MAL in the `X-MAL-CLIENT-ID` header.

| Component | Responsibility |
| --- | --- |
| `server/anime-http.ts` | Validate query, pagination, selection and format inputs; return consistent errors |
| `server/mal-service.ts` | Map provider facts, retrieve on demand, bound and deduplicate requests |
| `server/anime-series.ts` | Resolve verified continuity, distinguish shows from films, build popup groups |
| `src/engine/anime-ranker.ts` | Normalize and combine community support with deterministic ties |
| `src/lib/api.ts` | Reuse title details within the browser session and guard canceled callers |
| `src/pages/Results.tsx` | Preserve ranked order while revealing ten more cards at a time |

## Equal influence and overlap

1. Read the recommendation lists for the selected shows' verified installments.
2. Divide each count by that release list's original maximum, before exclusions or format filters. Keep that denominator even when a selected title or unavailable candidate is removed.
3. Resolve show identities. Keep the strongest normalized installment connection for each source-show/candidate-show pair.
4. Deduplicate selected shows. For each candidate, combine its support across every selected show using `(mean(sqrt(support)))²`.
5. Sort descending by score, breaking ties by stable MAL ID. Format filtering and later metadata enrichment do not recompute the normalization.

Unreturned connections contribute zero observed support; they are not proof that users dislike a candidate. Explicitly empty lists and omitted recommendation fields remain distinct and produce different information messages. An unavailable selection is not silently dropped from the equal-weight denominator.

The response retains empty `traits`, `sharedTraits`, and `seedFits` compatibility fields. No tag-based ranking or legacy catalog engine is included.

## Show and movie identity

MAL has release IDs and relationship edges, not an application-ready canonical show ID or season numbering scheme. AniRec follows verified prequel/sequel continuity among TV, ONA, OVA, and TV-special entries. It does not merge generic specials, summaries, remakes, or spin-offs into show identity.

Films keep independent identities and ranking cards. A film can bridge a story-continuity chain and appear under a show's related movies. Popup entries retain their actual MAL titles and scores. AniRec does not invent season numbers or a franchise-wide average rating.

Selected shows receive full membership resolution. Recommendation candidates need ancestry resolution; full popup groups load when opened. Cycles, inconsistent reciprocal relationships, ambiguous roots, and missing necessary links return recoverable errors instead of guessed identities.

## Performance boundaries

- Four concurrent upstream requests per process; search has priority and a reserved slot over background metadata requests.
- Provider cache: ten-minute expiry, at most 400 entries and 8 MiB of serialized payloads.
- Duplicate in-flight requests share work. Metadata enrichment only covers visible cards.
- Recommendation graph work has a 24-second budget, including queue waits and joined requests; individual network calls have at most eight seconds.
- Show traversal and recommendation work have explicit size limits and return errors when those limits are reached.
- The browser caches details for five minutes with bounded entry counts.
- Load more reveals the next ten items from an already-ranked snapshot without requesting unrelated recommendations.

These caches and queues are per process. They do not coordinate every autoscaled hosting instance. MAL availability, latency, and rate limits remain external dependencies. The implementation makes no universal response-time guarantee.

## Provider limitations

The app searches MAL on demand rather than importing a complete catalog. Search pagination follows MAL's returned cursor. Nested recommendation lists have no established pagination in this integration, so AniRec can only rank the lists MAL actually returns. There is no unrelated popularity fallback at exhaustion.

Missing artwork, scores, dates, and synopses remain unavailable. Community ratings describe the individual MAL entry and do not influence match order. Broad sequel relationships can group successor series; ambiguous or unusually large graphs can fail the bounded verification policy.

## Verification scope

Synthetic API fixtures test malformed IDs, upstream failures, timeouts, cache behavior, ranking invariants, graph boundaries, and route integration without credentials. Component tests verify generated markup and state helpers; they do not replace browser interaction, accessibility testing, or real provider checks. No user study or recommendation-accuracy benchmark has been conducted for this release.
