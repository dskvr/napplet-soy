import { expect, test } from 'bun:test';
import { createSavedStore, savedId } from './saved-napplets';
import { publicDetailPath } from '../../../../packages/backend/src/public-model';
import { encodeAddress } from '../../../../packages/protocol/src';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => map.clear(),
  };
}
const address = { kind: 35129 as const, pubkey: 'a'.repeat(64), identifier: 'design' };
const item = {
  title: 'Design',
  description: 'Create patterns',
  naddr: encodeAddress(address),
  revisionId: 'b'.repeat(64),
};

test('save is explicit, local, stable across publication updates and independent from pinned releases', () => {
  const storage = memoryStorage();
  const first = createSavedStore(() => storage);
  expect(first.snapshot()).toBe(first.snapshot());
  expect(first.snapshot()).toHaveLength(0);
  const indexed = {
    ...item,
    permalink: 'design-0123456789ab',
    privateTestField: 'never serialize',
  };
  first.set(indexed, true);
  const second = createSavedStore(() => storage);
  expect(publicDetailPath(second.snapshot()[0])).toBe('/a/design-0123456789ab');
  expect(storage.getItem(storage.key(0)!)).not.toContain('privateTestField');
  const renamed = {
    ...item,
    title: 'Renamed design',
    revisionId: 'c'.repeat(64),
    naddr: encodeAddress(address, ['wss://relay.example']),
  };
  const pinned = { ...item, naddr: null };
  expect(savedId(renamed)).toBe(savedId(item));
  second.set(pinned, true);
  first.set(renamed, true);
  const reloaded = createSavedStore(() => storage);
  expect(reloaded.snapshot()).toHaveLength(2);
  expect(
    publicDetailPath(
      reloaded.snapshot().find((x) => x.naddr)!,
      true,
    ),
  ).toBe('/n/' + renamed.naddr);
  expect(publicDetailPath(reloaded.snapshot().find((x) => !x.naddr)!)).toBe(
    '/r/' + pinned.revisionId,
  );
  reloaded.set(item, false);
  expect(reloaded.snapshot().map((x) => x.id)).toEqual([pinned.revisionId]);
});

test('corrupt entries are isolated and a storage failure cannot report a successful bookmark', () => {
  const storage = memoryStorage();
  const store = createSavedStore(() => storage);
  store.set(item, true);
  storage.setItem('napplet.soy.saved.v1.corrupt', 'oops');
  storage.setItem(
    'napplet.soy.saved.v1.' + 'd'.repeat(64),
    JSON.stringify({ ...item, permalink: '//outside.example', savedAt: 1 }),
  );
  const reloaded = createSavedStore(() => storage);
  expect(reloaded.snapshot().map((x) => x.title)).toEqual([item.title]);
  const blocked = createSavedStore(() => {
    throw new Error('unavailable');
  });
  expect(blocked.snapshot()).toHaveLength(0);
  expect(() => blocked.set(item, true)).toThrow('unavailable');
});
