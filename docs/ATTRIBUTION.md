# Sources and dependencies

## MyAnimeList

Anime titles, synopses, dates, genres, studios, formats, individual ratings, artwork URLs, and community recommendation counts come from the [official MyAnimeList API](https://myanimelist.net/apiconfig/references/api/v2).

AniRec is independent and noncommercial. It is not affiliated with or endorsed by MyAnimeList. Artwork and source content remain the property of their respective rights holders. A public code repository does not grant rights to MAL data or anime artwork. Screenshots document the application interface and can contain third-party artwork.

## Reused software

| Dependency | Source | License |
| --- | --- | --- |
| React | https://github.com/facebook/react | MIT |
| React Router | https://github.com/remix-run/react-router | MIT |
| Vite | https://github.com/vitejs/vite | MIT |
| Express | https://github.com/expressjs/express | MIT |
| Radix UI | https://github.com/radix-ui/primitives | MIT |
| Lucide | https://github.com/lucide-icons/lucide | ISC |
| dotenv | https://github.com/motdotla/dotenv | BSD-2-Clause |
| TypeScript | https://github.com/microsoft/TypeScript | Apache-2.0 |
| Vitest | https://github.com/vitest-dev/vitest | MIT |
| Supertest | https://github.com/forwardemail/supertest | MIT |
| esbuild | https://github.com/evanw/esbuild | MIT |
| tsx | https://github.com/privatenumber/tsx | MIT |

The project reuses these packages through their published APIs. The MAL adapter, ranking formula implementation, relationship resolver, and application interface are project code. No unofficial MAL wrapper or scraped catalog is included.

## Fonts

DM Sans and Fraunces are served locally through Fontsource and static assets. Both use the SIL Open Font License. Their notices are retained under `public/assets/licenses/`:

- [DM Sans](../public/assets/licenses/DM-Sans-OFL.txt)
- [Fraunces](../public/assets/licenses/Fraunces-OFL.txt)

Third-party components retain their licenses. No license grant for the original application code has been selected.
