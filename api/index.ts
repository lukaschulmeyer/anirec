import { createAnimeApp } from '../server/anime-http';
import { createMalService } from '../server/mal-service';

// Vercel supplies this at runtime. There is no credential or filesystem fallback.
export default createAnimeApp(createMalService(process.env.MAL_CLIENT_ID?.trim()));
