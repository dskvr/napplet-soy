import { createHash } from 'node:crypto';
import { escapeText } from 'entities';
import { policyPath, readPolicy } from '../../moderation/src/policy';
import { GALLERY_PAGE_SIZE } from './gallery';
import { indexStore } from './indexed-catalog';
import { communityEntries, readUnmoderatedCatalog } from './public-catalog';
import { publicDetailPath } from './public-model';
import { siteOrigin } from './site-origin';

const publicPages = ['/', '/gg', '/about', '/docs', '/create'];

async function buildSitemap(origin: string) {
  const entries = await communityEntries();
  const publications = new Map<string, number>();
  let expires = Infinity;
  for (const entry of entries) {
    if (entry.availability !== 'ready') continue;
    const expiration = entry.manifest.tags.find((t) => t[0] === 'expiration')?.[1];
    if (expiration && /^\d+$/.test(expiration)) {
      const deadline = Number(expiration) * 1000;
      if (deadline <= Date.now()) continue;
      expires = Math.min(expires, deadline);
    }
    publications.set(publicDetailPath(entry), entry.manifest.created_at);
  }
  const url = (path: string, lastModified?: number) => {
    const modified =
      lastModified !== undefined && lastModified * 1000 <= Date.now()
        ? `<lastmod>${new Date(lastModified * 1000).toISOString()}</lastmod>`
        : '';
    return `  <url><loc>${escapeText(origin + path)}</loc>${modified}</url>`;
  };
  const urls = publicPages.map((path) => url(path));
  for (let page = 2; page <= Math.ceil(publications.size / GALLERY_PAGE_SIZE); page++) {
    urls.push(url(`/?page=${page}`));
  }
  for (const path of [...publications.keys()].sort()) urls.push(url(path, publications.get(path)));
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
  return { body, expires, etag: `"${createHash('sha256').update(body).digest('hex')}"` };
}

let cache: { inputs: unknown[]; document: Awaited<ReturnType<typeof buildSitemap>> } | undefined;

export async function sitemapResponse(request: Request) {
  try {
    const origin = siteOrigin();
    const store = indexStore();
    // An unavailable index must not tell crawlers the catalogue has been withdrawn.
    if (process.env.SPACE_INDEX_DIR && !store) throw new Error('Index unavailable');
    const inputs = [
      origin,
      store,
      store?.dataVersion(),
      await readUnmoderatedCatalog(),
      policyPath() ? readPolicy() : null,
      process.env.SPACE_COMMUNITY_DIR,
    ];
    const previousInputs = cache?.inputs;
    if (
      !cache ||
      Date.now() >= cache.document.expires ||
      inputs.some((source, index) => source !== previousInputs?.[index])
    ) {
      cache = { inputs, document: await buildSitemap(origin) };
    }
    const { body, etag } = cache.document;
    const headers = {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, no-cache',
      ETag: etag,
    };
    if (request.headers.get('if-none-match') === etag)
      return new Response(null, { status: 304, headers });
    return new Response(request.method === 'HEAD' ? null : body, { headers });
  } catch {
    return new Response('Sitemap temporarily unavailable', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' },
    });
  }
}

export function robotsResponse(request: Request) {
  return new Response(
    request.method === 'HEAD'
      ? null
      : `User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin()}/sitemap.xml\n`,
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    },
  );
}
