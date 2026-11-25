import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { initializePolicy, updatePolicy } from '../../moderation/src/policy';
import fixtures from '../data/catalog.json';
import { indexStore } from './indexed-catalog';
import { IndexStore } from './index-store';
import { communityEntries } from './public-catalog';
import { publicDetailPath, publicNapplet } from './public-model';
import { robotsResponse, sitemapResponse } from './sitemap';

const names = [
  'SPACE_COMMUNITY_DIR',
  'SPACE_INDEX_DIR',
  'SPACE_MODERATION_FILE',
  'SPACE_PUBLICDEV',
  'SPACE_SITE_ORIGIN',
];
const previous = Object.fromEntries(names.map((key) => [key, process.env[key]]));
const origin = 'https://catalogue.example';
const secret = generateSecretKey();
const now = Math.floor(Date.now() / 1000) - 30;
const request = (init?: RequestInit) => new Request('https://untrusted.example/sitemap.xml', init);
let root: string;
let writer: IndexStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'napplet-sitemap-'));
  process.env.SPACE_INDEX_DIR = join(root, 'index');
  process.env.SPACE_COMMUNITY_DIR = join(root, 'names');
  process.env.SPACE_MODERATION_FILE = join(root, 'moderation.json');
  process.env.SPACE_SITE_ORIGIN = origin;
  delete process.env.SPACE_PUBLICDEV;
  initializePolicy(process.env.SPACE_MODERATION_FILE);
  writer = new IndexStore(process.env.SPACE_INDEX_DIR, true);
});
afterEach(async () => {
  setSystemTime();
  writer.close();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  indexStore();
  await rm(root, { recursive: true, force: true });
});

async function addPublication(identifier: string, ready = true, extraTags: string[][] = []) {
  const tags = fixtures[0].current.tags.filter(([tag]) => tag !== 'd');
  const manifest = finalizeEvent(
    {
      kind: 35129,
      created_at: now,
      content: '',
      tags: [...tags, ['d', identifier], ...extraTags],
    },
    secret,
  );
  writer.admit(manifest);
  if (ready)
    writer.project(
      manifest.id,
      { ...(await publicNapplet(manifest)), availability: 'ready' },
      0,
      0,
    );
  return manifest;
}

test('sitemap advertises only canonical public pages, refreshes on moderation and deletion, and revalidates', async () => {
  await addPublication('hidden-unavailable', false);
  const manifest = await addPublication('sitemap-sample');
  const entries = await communityEntries();
  const visible = entries.find((entry) => entry.availability === 'ready')!;
  const unavailable = entries.find((entry) => entry.availability === 'unavailable')!;
  const loc = `<loc>${origin}${publicDetailPath(visible)}</loc>`;
  const response = await sitemapResponse(request());
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('application/xml');
  const etag = response.headers.get('etag')!;
  const body = await response.text();
  expect(body).toContain(`${loc}<lastmod>${new Date(now * 1000).toISOString()}</lastmod>`);
  expect(body).toContain(`<loc>${origin}/gg</loc>`);
  expect(body).toContain(`<loc>${origin}/docs</loc>`);
  expect(body).not.toContain(publicDetailPath(unavailable));
  expect(body).not.toMatch(/untrusted|\/manage|\/studio|\/play|\/admin|\?q=/);
  const conditional = () => sitemapResponse(request({ headers: { 'If-None-Match': etag } }));
  expect((await conditional()).status).toBe(304);
  const head = await sitemapResponse(request({ method: 'HEAD' }));
  expect(head.headers.get('etag')).toBe(etag);
  expect(await head.text()).toBe('');

  for (const [revision, action] of (['block', 'unblock'] as const).entries()) {
    updatePolicy(
      { action, type: 'event', target: manifest.id, reason: 'Sitemap test', revision },
      manifest.pubkey,
      String(revision + 1).padStart(64, '0'),
    );
    const fresh = await sitemapResponse(request());
    expect((await fresh.text()).includes(loc)).toBe(action === 'unblock');
  }
  writer.admit(
    finalizeEvent(
      { kind: 5, created_at: now + 1, content: '', tags: [['e', manifest.id]] },
      secret,
    ),
  );
  const withdrawn = await conditional();
  expect(withdrawn.status).toBe(200);
  expect(await withdrawn.text()).not.toContain(loc);
});

test('cached sitemap expires with signed listings and fails closed on moderation read errors', async () => {
  const deadline = now + 120;
  await addPublication('expires-soon', true, [['expiration', String(deadline)]]);
  const loc = publicDetailPath((await communityEntries())[0]);
  expect(await (await sitemapResponse(request())).text()).toContain(loc);
  setSystemTime(new Date(deadline * 1000));
  expect(await (await sitemapResponse(request())).text()).not.toContain(loc);
  await Bun.write(process.env.SPACE_MODERATION_FILE!, 'incomplete');
  const error = await sitemapResponse(request());
  expect(error.status).toBe(503);
  expect(error.headers.get('cache-control')).toBe('no-store');
});

test('robots advertises the configured origin and sitemap pages track unfiltered gallery pagination', async () => {
  const robots = robotsResponse(request());
  expect(robots.headers.get('content-type')).toContain('text/plain');
  expect(await robots.text()).toContain(`Sitemap: ${origin}/sitemap.xml`);
  for (let i = 0; i < 25; i++) await addPublication(`game-${i}`);
  const body = await (await sitemapResponse(request())).text();
  expect(body).toContain(`<loc>${origin}/?page=2</loc>`);
  expect(body).not.toContain('?page=3');
  expect(new Set(body.match(/<loc>[^<]+<\/loc>/g)).size).toBe(31);
  process.env.SPACE_SITE_ORIGIN = 'https://a&b.example';
  expect(await (await sitemapResponse(request())).text()).toContain(
    '<loc>https://a&amp;b.example/</loc>',
  );
  process.env.SPACE_INDEX_DIR = join(root, 'index-not-ready');
  expect((await sitemapResponse(request())).status).toBe(503);
});
