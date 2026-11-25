import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { CommunityStore } from './store';
import { encodeAddress, sha256 } from '../../protocol/src';
import { namesResponse } from '../../backend/src/names-response';
import { siteOrigin } from '../../backend/src/site-origin';
test('signed names survive restarts, normalize relay hints and cannot be stolen or reassigned', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'space-names-'));
  let store = new CommunityStore(dir);
  try {
    const key = generateSecretKey(),
      pubkey = getPublicKey(key),
      identity = { kind: 35129 as const, pubkey, identifier: 'one' },
      naddr = encodeAddress(identity, ['wss://relay.example']);
    const url = siteOrigin() + '/api/names';
    let tick = 0;
    const request = async (body: unknown, signer = key, mismatch = false) => {
      const text = JSON.stringify(body);
      const event = finalizeEvent(
        {
          kind: 27235,
          created_at: Math.floor(Date.now() / 1000),
          content: '',
          tags: [
            ['u', url],
            ['method', 'POST'],
            ['payload', await sha256(new TextEncoder().encode(text))],
            ['nonce', String(tick++)],
          ],
        },
        signer,
      );
      return new Request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`,
        },
        body: mismatch ? '{}' : text,
      });
    };
    const body = { handle: 'alice', slug: 'first', naddr };
    const signed = await request(body);
    expect((await namesResponse(signed.clone(), store)).status).toBe(200);
    expect((await namesResponse(signed, store)).status).toBe(409);
    expect((await namesResponse(await request(body, key, true), store)).status).toBe(401);
    expect((await namesResponse(await request(body, generateSecretKey()), store)).status).toBe(403);
    expect(
      (
        await namesResponse(
          await request({ ...body, naddr: encodeAddress({ ...identity, identifier: 'two' }) }),
          store,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await namesResponse(
          await request({ ...body, naddr: encodeAddress(identity, ['wss://other.example']) }),
          store,
        )
      ).status,
    ).toBe(200);
    const key2 = generateSecretKey();
    expect(
      (
        await namesResponse(
          await request(
            { ...body, naddr: encodeAddress({ ...identity, pubkey: getPublicKey(key2) }) },
            key2,
          ),
          store,
        )
      ).status,
    ).toBe(409);
    expect(
      (await namesResponse(await request({ ...body, handle: 'space-lab' }), store)).status,
    ).toBe(409);
    store.close();
    store = new CommunityStore(dir);
    expect(store.lookup('alice', 'first')?.naddr).toBe(encodeAddress(identity));
    expect(store.creator('alice')).toHaveLength(1);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('publication links freeze the first title and bind the suffix to the full identity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'space-permalink-'));
  let store = new CommunityStore(dir);
  try {
    const identity = { kind: 35129 as const, pubkey: 'a'.repeat(64), identifier: 'test' };
    const portable = encodeAddress(identity);
    const link = store.registerPublication(
      encodeAddress(identity, ['wss://example.org']),
      'Póly Cube!',
    );
    expect(link).toMatch(/^poly-cube-[0-9a-f]{12}$/);
    store.close();
    store = new CommunityStore(dir);
    expect(store.registerPublication(portable, 'Renamed')).toBe(link);
    expect(store.publicationAddress(link)).toBe(portable);
    expect(store.publicationAddress(link.replace('poly', 'other'))).toBeUndefined();
    const other = encodeAddress({ ...identity, identifier: 'other' });
    expect(store.registerPublication(other, 'Póly Cube!')).not.toBe(link);
    expect(
      store.registerPublication(encodeAddress({ ...identity, kind: 15129, identifier: '' }), '星'),
    ).toMatch(/^napplet-[0-9a-f]{12}$/);

    // Reserve the first suffix to exercise the collision path without a hash search.
    const digest = createHash('sha256').update(`35129:${identity.pubkey}:collision`).digest('hex');
    store.db.run('INSERT INTO publication_links VALUES(?,?,?,?)', [
      'reserved',
      digest.slice(0, 12),
      'reserved-link',
      'reserved-naddr',
    ]);
    const disputed = encodeAddress({ ...identity, identifier: 'collision' });
    expect(store.registerPublication(disputed, 'Póly Cube!')).toBe(
      `poly-cube-${digest.slice(0, 16)}`,
    );
    expect(store.publicationAddress('reserved-link')).toBe('reserved-naddr');
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
