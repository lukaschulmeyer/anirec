import { build } from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(root, 'deployment', stamp);
await mkdir(path.join(target, 'api'), { recursive: true });
await cp(path.join(root, 'dist'), path.join(target, 'public'), { recursive: true });
await build({ entryPoints: [path.join(root, 'api/index.ts')], outfile: path.join(target, 'api/index.js'),
  bundle: true, platform: 'node', target: 'node24', format: 'cjs', sourcemap: false,
  legalComments: 'eof', logLevel: 'warning' });
const config = {
  $schema: 'https://openapi.vercel.sh/vercel.json', framework: null,
  installCommand: '', buildCommand: '', outputDirectory: 'public',
  cleanUrls: true, trailingSlash: false,
  functions: { 'api/index.js': { maxDuration: 30 } },
  rewrites: [{ source: '/api/:path*', destination: '/api' }, { source: '/recs', destination: '/' }],
  headers: [{ source: '/(.*)', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://cdn.myanimelist.net https://myanimelist.net https://myanimelist.cdn-dena.com data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'" },
  ] }, { source: '/assets/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] }],
};
await writeFile(path.join(target, 'vercel.json'), JSON.stringify(config, null, 2));
await writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'anirec-deployment', private: true, type: 'commonjs', engines: { node: '24.x' } }, null, 2));
await writeFile(path.join(target, '.vercelignore'), '.env*\n.vercel/\n');
console.log(`Vercel package: ${target}`);
console.log('Configure MAL_CLIENT_ID in your Vercel project, then deploy this generated directory.');
